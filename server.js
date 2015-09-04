var g    = require('./global.js'),
    api  = require('./api.js'),
    push = require('./push.js'),
    https= require('https'),   
    url  = require('url'),
    express = require('express'),
    app  = express(),
    fs   = require('fs'),
    bcrypt = require('bcrypt');

/* Set up app to serve static content */

app.use(express.static(__dirname + '/www'));
app.listen(3000);
console.log('Serving static content on 3000');

/* Configuration */

var env = 'local';
for (var i = 2; i < process.argv.length; i++) {
    switch (process.argv[i]) {
        case '-e': // Environment
            env = process.argv[++i]; break;
        default:
            throw 'Unrecognized argument: ' + process.argv[i];
    }
}

console.log('Starting node on ' + env);

// To hit the dev database locally, set up a tunnel through bento-dev-api1
// ssh -N marc@bento-dev-api1 -L 3306:<database_host>:3306
g.mysql = new require('./db.js')(env);
console.log('Initialized database connection pool');

var conf = require('./private-NO-COMMIT.js')[env];

console.log('Attempting to connect to redis at ' + conf.redis.host + ':' + conf.redis.port);
g.redis = require('redis').createClient(conf.redis.port, conf.redis.host, { });
console.log('Connected to redis');

/* HTTP */

// prepare ssl credentials
// XXX: Most browsers are configured by default to reject secure connections from servers with self-signed certificates.
// To test locally, manually visit https://localhost:8081/ to trigger the warning page and add the exception.
var options = {
    key : fs.readFileSync(conf.server.resources_dir + '/key.pem' ).toString(),
    cert: fs.readFileSync(conf.server.resources_dir + '/cert.pem').toString(),
};

g.server = https.createServer(options, function (req, res) {
    // Ignore SOP with Access-Control-Allow-Origin (testing only)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/json');
    res.writeHead(200);
    var invoke = function (uid, token, fn, params) {
        if (!g.isset(api[fn])) {
            res.end(api.error('not_found'));
        } else if (!g.isset(uid)) { 
            res.end(api.error('malformed_request'));
        } else if ((fn != '/api/authenticate' && (!g.isset(token) || !api.verify_token(uid, token))) || !api.is_valid(req)) {
            res.end(api.error('bad_auth'));
        } else {
            //try {
                // XXX: It's very important that these request handlers are invoked with apply().
                // Turns out the context must be supplied manually so that the keyword this
                // works properly in the module.
                api[fn].apply(api, [params, function (resp) {
                    res.end(resp);      
                }]);
            //} catch (err) {
            //    console.log(err);
            //    res.end(api.error('generic'));
            //}
        }
    };
    // Handle normal HTTP requests in here.
    if (req.method == 'POST') {
        var body = '';
        req.on('data', function (data) {
            body += data;
        });
        req.on('end', function () {
            console.log('received this from post request: ' + body);
        });
        // not supported for now
        res.end(api.error('not_found'));
    } else {
        // GET
        var urlParts = url.parse(req.url, true);
        var uid = urlParts.query['uid'];
        var token = urlParts.query['token'];
        var fn = urlParts.pathname;
        invoke(uid, token, fn, urlParts.query);
    }
});

/* WebSocket */

// Attach socket.io to the above HTTP server.
g.io = require('socket.io')(g.server);

g.io.use(function (soc, next) {
    var clientId = soc.handshake.query.uid;
    if (!g.isset(clientId)) {
        // TODO: Need to investigate this.
        // calling next(new Error()) does not close the connection; must do it manually =(
        next(new Error("Missing 'uid' connection parameter"));
        soc.disconnect();
    }
    var curr = g.getSocket(clientId);
    if (curr != null && curr.connected == true) {
        next(new Error('There is already a connection opened for client ' + clientId));
    } else {
        soc['clientId'] = clientId;
        soc['authenticated'] = false;
        next();
    }
});

g.io.on('connection', function (soc) {
  
    // Handshake must include client identifier.
    var clientId = soc['clientId'];
    console.log('Accepted WebSocket connection with ' + clientId);

    // WebSocket equivalent of GET requests.
    // data = {
    //   api: '/api/push',
    //   params: {
    //    
    //   },
    //   token: Abc0yprsT,
    // }
    soc.on('get', function (data, callback) {
        if (g.empty(data['api']) || !g.isset(data['params']) || data['params'] == null) {
            callback(api.error('malformed_request'));
            return;
        }
        // Add client identifier to params object
        data['params']['uid'] = clientId;
        // The API function to invoke.
        var fn = data['api'];
        if (!g.isset(api[fn])) {
            callback(api.error('not_found'));
        } else if (fn == '/api/authenticate') {
            // Must do extra work for WebSocket authentication.
            api['/api/authenticate'](data['params'], function (str) {
                var res = JSON.parse(str);
                // If successful, mark socket as authenticated then associate client with socket identifier.
                if (res['code'] == 0 && !g.empty(res['ret'])) {
                    soc['authenticated'] = true;
                    g.sockets[clientId] = soc.id;
                    console.log('Assigned ' + clientId + ' access token ' + res['ret']['token']);
                    //g.tokens[clientId] = res['ret']; // Done automatically in /api/authenticate
                    // Send any pending notifications.
                    push.flush(clientId);
                    // Notify any subscribers that this client is now online
                    api.notify_status(clientId, 'connected');
                }
                callback(str);
            });
        } else if (g.isset(data['token']) && api.verify_token(clientId, data['token'])) { // What about is_valid()?
            // Otherwise, token must be valid in order to invoke API function.
            try {
                api[fn].apply(api, [data['params'], callback]);
            } catch (err) {
                console.log(err);
                callback(api.error('generic'));
            }
        } else {
            callback(api.error('bad_auth'));
        }
    }); 
    
    // All clients must authenticate in the allotted timeframe, otherwise the connection will be terminated.
    setTimeout(function () {
        if (soc['authenticated'] == false && soc.connected) {
            console.log('Disconnecting ' + clientId + ' for failure to authenticate');
            // This is the only time the server calls disconnect. The behavior is different such that
            // if the server shuts down, while the connection is lost, resuming does not force the 
            // user to re-authenticate.
            soc.disconnect();
        }
    }, 60000);
  
    soc.on('disconnect', function () {
        // TCP does not guarantee that a connection terminates cleanly. A socket.io client
        // automatically emits heartbeats periodically to affirm the server of its
        // connection status.
        console.log(clientId + ' has disconnected');
        // Notify all subscribers that a user has disconnected
        delete g.sockets[clientId];
        delete g.tokens[clientId];
        if (soc.authenticated) {
            api.notify_status(clientId, 'disconnected');
        }
    });
});

/* Start the server */

var serverPort = conf.server.port;

g.server.listen(serverPort);//.setTimeout(30000); // 30 sec

console.log('Hello, World! Server listening on port ' + serverPort + '.');
