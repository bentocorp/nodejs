var g    = require('./global.js'), // XXX: Why does this work? These are not core modules.
    http = require('http'),   // XXX: Must use relative path!
    url  = require('url'),
    api  = require('./api.js'),
    push = require('./push.js'),
    express = require('express'),
    app  = express();

app.use(express.static(__dirname + '/node_modules'));
app.listen(3000);
console.log('Serving static content on 3000');

/** Configuration **/
var args = [];
for (var i = 2; i < process.argv.length; i++) {
  var kv = process.argv[i].match(/^\-\-([a-z0-9]+)=([a-z0-9]+)$/i);
  args[kv[1]] = kv[2];
}
if (!g.isset(args['env'])){
  throw 'Missing env argument.';
}
console.log('env='+args['env']);
var conf = require('./conf.js')[args['env']];

console.log('Attempting to connect to redis at ' + conf.redis.host + ':' + conf.redis.port);
g.redis = require('redis').createClient(conf.redis.port, conf.redis.host, { });
console.log('Connected.');

/** HTTP **/
g.server = http.createServer(function (req, res) {
  // Handle normal HTTP requests in here.
  var urlParts = url.parse(req.url, true);
  var fn = api[urlParts.pathname];
  if (g.isset(fn) && api.isValid(req)) {
    // Ignore SOP with Access-Control-Allow-Origin (testing only)
    res.writeHead(200, {'Content-Type': 'text/json', 'Access-Control-Allow-Origin': '*'});
    // XXX: It's very important that these request handlers are invoked with apply().
    // Turns out the context must be supplied manually so that the keyword this
    // works properly in the module.
    fn.apply(api, [urlParts.query, function (ret) {
      res.end(JSON.stringify(ret));      
    }]);
  } else {
    res.writeHead(404);
    res.end('Unsupported API call ' + req.url);
  }
});

/** WebSocket **/
// Attach socket.io to the above HTTP server.

g.io = require('socket.io')(g.server);
g.io.on('connection', function (soc) {
  // Handshake must include client identifier, API token, and client type.
  var clientId = soc.handshake.query.clientId;

  // Authenticate here.

  console.log("io: Accepted WebSocket connection with client " + clientId);

  g.sockets[clientId] = soc.id;
  
  // Send any pending notifications.
  push.flush(clientId);
  
  soc.on('disconnect', function () {
    // TCP does not guarantee that a connection terminates cleanly. A socket.io client
    // automatically emits heartbeats periodically to affirm the server of its
    // connection status.
    console.log('io: Client ' + clientId + ' has disconnected.');
    delete g.sockets[clientId];
  });
});

/* Start the server. */
var serverPort = conf.server.port;
g.server.listen(serverPort);//.setTimeout(30000); // 30 sec
console.log('Hello, World! Server listening on port ' + serverPort + '.');

