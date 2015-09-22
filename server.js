var g    = require('./global.js'),
    api  = require('./api.js'),
    push = require('./push.js'),
    https= require('https'), 
    http = require('http'),  
    url  = require('url'),
    express = require('express'),
    app  = express(),
    fs   = require('fs'),
    bcrypt = require('bcrypt');
/*
process.on('uncaughtException', function (err) {
    console.log(err.stack);
    g.error(err);
    process.exit(1);
});
*/
/* Set up app to serve static content */

app.use(express.static(__dirname + '/www'));
app.listen(3000);
g.debug('Serving static content on port 3000');

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

g.debug('Setting up node environment ' + env);

/* database */
// To hit the dev database locally, set up a tunnel through bento-dev-api1
// ssh -N marc@bento-dev-api1 -L 3306:<database_host>:3306
g.debug('Setting up database connectivity');
g.mysql = new require('./db.js')(env);

var conf = require('./private-NO-COMMIT.js')[env];

/* redis */
g.debug('Attempting to connect to redis at {0}:{1}'.format(conf.redis.host, conf.redis.port));
g.redis = require('redis').createClient(conf.redis.port, conf.redis.host, { });
g.debug('Connected to redis');

/* HTTP */

// prepare ssl credentials
// XXX: Most browsers are configured by default to reject secure connections from servers with self-signed certificates.
// To test locally, manually visit https://localhost:8081/ to trigger the warning page and add the exception.
var options = {
    key : fs.readFileSync(conf.server.resources_dir + '/key.pem' ).toString(),
    cert: fs.readFileSync(conf.server.resources_dir + '/cert.pem').toString(),
};

g.server = http.createServer(function (req, res) {
//g.server = https.createServer(options, function (req, res) {
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
            try {
                // XXX: It's very important that these request handlers are invoked with apply().
                // Turns out the context must be supplied manually so that the keyword this
                // works properly in the module.
                api[fn].apply(api, [params, function (resp) {
                    res.end(resp);      
                }]);
            } catch (err) {
                //console.log(err.stack);
                g.error(err);
                res.end(api.error('generic'));
            }
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

// Attach socket.io to the above HTTP server
g.io = require('socket.io')(g.server);

g.io.of('/').use(function (soc, next) {
    // Temporary identifier for debugging purposes (to track unauthenticated sockets); not required
    var name = soc.handshake.query.name;
    /*
    if (!g.isset(clientId)) {
        // XXX: Investigate - client will not receive this error message because
        // of the way socket.io is implemented =(
        next(new Error('Missing "uid" connection parameter'));
        console.log('Rejected WebSocket connection due to missing "uid" connection parameter');
        // pass true to close underlying socket connection
        soc.disconnect(true);
    }
    */
    if (!g.isset(name)) {
        soc.name = g.idgen.next('socket'); // socket-0
    } else {
        soc.name = g.idgen.next(name);
    }
    /*
    var curr = g.getSocket(clientId);
    if (curr != null && curr.connected == true) {
        var msg = 'There is already a connection opened for client ' + clientId;
        console.log(msg);
        next(new Error(msg));
        // XXX: This next(new Error()) thing needs to be more understood!
        soc.disconnect(true);
    } else {
        soc['clientId'] = clientId;
        soc['authenticated'] = false;
        next();
    }
    */
    soc['authenticated'] = false;
    soc['ready'] = false;
    next();
});

g.io.on('connection', function (soc) {

    g.debug('Accepted WebSocket connection with ' + soc.name);

    soc.on('get', function (data, callback) {
        if (g.empty(data)) {
            g.error('Error - received empty data on get channel');
            callback(api.error('malformed_request'));
            return;
        }
        var urlParts = decodeURI(data).split('?');
        // fn - the API function to invoke
        var fn = urlParts[0], params = { };
        if (g.isset(urlParts[1])) {
            var query = urlParts[1].split('&');
            for (var i = 0; i < query.length; i++) {
                var kv = query[i].split('=');
                params[kv[0]] = kv[1];
            }
        }
        if (!g.isset(api[fn])) {
            callback(api.error('not_found'));
        } else if (fn == '/api/authenticate') {
            // Must do extra work for WebSocket authentication
            api['/api/authenticate'](params, function (str) {
                var res = JSON.parse(str);
                // If successful, mark socket as authenticated then associate client with socket identifier
                if (res['code'] == 0 && !g.empty(res['ret'])) {
                    soc.authenticated = true;
                    var clientId = res.ret.uid;
                    soc.clientId = clientId;
                    g.setSocketId(clientId, soc.id);
                    var name = g.idgen.next(clientId); // d-500-1
                    g.debug('{0} successfully authenticated; renaming to {1}'.format(soc.name, name));
                    g.idgen.free(soc.name);
                    soc.name = name;
                    // Send any pending notifications
                    params.uid = clientId;
                    api['/api/ready'](params, function () { });
                    // Notify any subscribers that this client is now online
                    api.notify_status(clientId, 'connected');
                }
                callback(str);
            });
        } else if (soc.authenticated) { // What about is_valid()?
            // Token not needed for WebSocket protocol?
            //g.isset(params['token']) && api.verify_token(soc.clientId, params['token'])
            try {
                params.uid = soc.clientId;
                api[fn].apply(api, [params, callback]);
            } catch (err) {
                g.error(err);
                callback(api.error('generic'));
            }
        } else {
            callback(api.error('bad_auth'));
        }
    }); 
    
    // All clients must authenticate in the allotted timeframe, otherwise the connection will be terminated
    setTimeout(function () {
        if (!soc.authenticated && soc.connected) {
            g.debug('Disconnecting ' + soc.name + ' for failure to authenticate');
            // This is the only time the server calls disconnect. The behavior is different such that
            // if the server shuts down, while the connection is lost, resuming does not force the 
            // user to re-authenticate.
            soc.disconnect(true);
        }
    }, 5000);

    soc.on('disconnect', function () {
        g.debug(soc.name + ' has disconnected');
        g.idgen.free(soc.name);
        if (soc.authenticated) {
            var sids = g.sockets[soc.clientId];
            var i = sids.indexOf(soc.id);
            sids.splice(i, 1);
            if (sids.length == 0) {
                // Notify subscribers if all user instances have disconnected
                delete g.sockets[soc.clientId];
                delete g.tokens[soc.clientId];
                api.notify_status(soc.clientId, 'disconnected');
            }
        }
    });
});

/* Start the server */

var serverPort = conf.server.port;

g.server.listen(serverPort);//.setTimeout(30000); // 30 sec

g.debug('Hello, World! Server listening on port ' + serverPort);
