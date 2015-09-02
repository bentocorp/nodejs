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

// To test locally, point h
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
    // Handle normal HTTP requests in here.
    var urlParts = url.parse(req.url, true);
    var fn = api[urlParts.pathname];
    var uid = urlParts.query['uid'];
    var token = urlParts.query['token'];
    if (g.isset(token) && api.verify_token(uid, token)) {
        if (g.isset(fn) && api.is_valid(req)) {
            // Ignore SOP with Access-Control-Allow-Origin (testing only)
            res.writeHead(200, {'Content-Type': 'text/json', 'Access-Control-Allow-Origin': '*'});
            // XXX: It's very important that these request handlers are invoked with apply().
            // Turns out the context must be supplied manually so that the keyword this
            // works properly in the module.
            try {
                fn.apply(api, [urlParts.query, function (ret) {
                    res.end(JSON.stringify(ret));      
                }]);
            } catch (err) {
                res.end('Error: Problem invoking ' + fn + ' - ' + err);
            }
        } else {
            res.writeHead(404);
            res.end('Unsupported API call ' + req.url);
        }
    } else {
        res.writeHead(401, {'Content-Type': 'text/json', 'Access-Control-Allow-Origin': '*'});
        res.end('Bad authentication credentials.');
    }
});

/* WebSocket */

// Attach socket.io to the above HTTP server.
g.io = require('socket.io')(g.server);

g.io.use(function (soc, next) {
    var clientId = soc.handshake.query.client_id;
    var curr = g.get_socket(clientId);
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
    // 
    // }
    soc.on('get', function (data, callback) {
        // The API function to invoke.
        var fn = data['api'];
        // Must do extra work for WebSocket authentication.
        if (fn == '/api/authenticate') {
            api['/api/authenticate'](data['params'], function (res) {
                // If successful, mark socket as authenticated then associate client with socket identifier.
                if (res['code'] == 0 && !g.empty(res['ret'])) {
                    soc['authenticated'] = true;
                    g.sockets[clientId] = soc.id;
                    console.log('Assigned ' + clientId + ' access token ' + res['ret']['token']);
                    g.tokens[clientId] = res['ret'];
                    // Send any pending notifications.
                    push.flush(clientId);
                }
                callback(res);
            });
        } else if (g.isset(data['token']) && api.verify_token(data['uid'], data['token'])) {
            // Otherwise, token must be valid in order to invoke API function.
            try {
                api[fn].apply(api, [data['params'], callback]);
            } catch (err) {
                callback({
                    code: 1, msg: 'Error: Problem invoking ' + fn + ' - ' + err, ret: null,
                });
            }
        } else {
            callback({
                code: 1, msg: 'Bad authentication credentials', ret: null,
            });
        }
    }); 
    
    // All clients must authenticate in the allotted timeframe, otherwise the connection will be terminated.
    setTimeout(function () {
        if (soc['authenticated'] == false) {
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
        //api.notifyStatus(clientId, 'DISCONNECTED');
        delete g.sockets[clientId];
        delete g.tokens[clientId];
    });
});

/* Start the server */

var serverPort = conf.server.port;

g.server.listen(serverPort);//.setTimeout(30000); // 30 sec

console.log('Hello, World! Server listening on port ' + serverPort + '.');
