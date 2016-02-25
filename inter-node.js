var g   = require('./global.js'),
    api = require('./api.js');

function genid() {
	// https://github.com/defunctzombie/node-uuid
	// v4 - based on random numbers
	// The original from broofa has been known to generate duplicates of v4 uuids!
	return require('uuid').v4();
}

module.exports = function (redis, conf, id) {
	var self = this;
	var client0 = redis.createClient(conf.redis.port, conf.redis.host, { }),
		writer  = redis.createClient(conf.redis.port, conf.redis.host, { }),
		uuid 	= g.isset(id) ? id : genid();
	
	g.debug('This server has been assigned a uuid of ' + uuid);
	
	var servers = { };
	// Initialize the servers object with our own information
	servers[uuid] = {
		// Can be empty because we won't be using here
	}
	// When a server dies, the remaining servers must divy up the work
	var _serverdeath = function (serverId) {
		delete servers[serverId];
		var active = Object.keys(servers);
		// We must sort all servers by serverId to gaurantee that all sockets are handled by one of us
		active.sort();
		var socs = Object.keys(g.sockets[serverId].connected);
		delete g.sockets[serverId];
		socs.sort();
		for (var i = 0; i < socs.length; i++) {
			var clientId = socs[i];
			if (!g.isconnected(clientId)) {
				// Every server must expire access token if all client instances have disconnected
				delete g.tokens[clientId];
				// Then check to see if we are responsible for notifying trackers of changes in status
				var serverSubstitute = active[i % active.length];
				if (uuid == serverSubstitute) {
					api.notify_status(clientId, 'disconnected');
				}
			}
		}
	};

	// Increasing activeInterval to 3000 ms because 1000 ms may have been too short. In one incident, missed heartbeats (due to network
	// latency?) caused all servers to believe the other had disconnected then reconnected in under 1 second.
	var activeInterval = 3000; // ms
	this.checkIfServerActive = function (uuid) {
		var socs = g.sockets[uuid];
		if (!g.isset(socs)) {
			g.error('Error - checking if non-existent server {0} is active'.format(uuid));
			return;
		}
		if ((new Date).getTime() - socs.heartbeatTs >= activeInterval) {
			// dead
			g.debug('Server {0} disconnected'.format(uuid));
			_serverdeath(uuid);
		} else {
			//console.log('    checking if {0} active - yes'.format(uuid));
			setTimeout(function () { self.checkIfServerActive(uuid); }, activeInterval);
		}
	};

	// connect socket
	this.csocket = function (clientId, sid, token) {
		// create a socket connection event
		var event = { uuid: uuid, clientId: clientId, sid: sid, connected: true, 'token': token };
		_processSocketEvent(event);
		// Let 
		writer.publish('soc-info', JSON.stringify(event));
	};

	// disconnect socket
	this.dsocket = function (clientId, sid) {
		var event = { uuid: uuid, clientId: clientId, sid: sid, connected: false };
		_processSocketEvent(event);
		writer.publish('soc-info', JSON.stringify(event));
	};

	var _processSocketEvent = function (o) {
		var serverId  = o.uuid,
			clientId  = o.clientId,
			sid       = o.sid,
			connected = o.connected,
			token     = o.token;
		if (connected) {
			// If we are the first server to see a client connect, it is our responsibility to notify trackers
   			if (!g.isconnected(clientId) && serverId == uuid) {
   				console.log('    notifying status - {0}, connected'.format(clientId));
   				api.notify_status(clientId, 'connected');
   			}
			console.log('    persisting    connected - {0}, {1}, {2}'.format(serverId, clientId, sid));
			g.setSocketId(serverId, clientId, sid);
			if (g.isset(token)) {
				console.log(    'token - {0}, {1}'.format(clientId, token));
				g.tokens[clientId] = token;
			}
		} else {
			console.log('    persisting disconnected - {0}, {1}, {2}'.format(serverId, clientId, sid));
			g.removeSocketId(serverId, clientId, sid);
            if (!g.isconnected(clientId)) {
            	console.log('    deleting g.tokens[{0}]'.format(clientId));
            	delete g.tokens[clientId];
            	if (o.uuid == uuid) {
            		// Notify subscribers if all user instances have disconnected
                	console.log('    notifying status - {0}, disconnected'.format(o.clientId));
                	api.notify_status(clientId, 'disconnected');
            	}
            }
		}
	};

	client0.on('message', function (channel, msg) {
		switch (channel) {
			case 'sigint':
				var serverId = msg;
				console.log('    got sigint from server {0} - treating as disconnect! There may be an error on the next checkIfServerActive'.format(serverId));
				_serverdeath(serverId);
				break;
			case 'node-heartbeat':
				var serverId = msg;
				if (serverId == uuid) {
					// Ignore our own heartbeats
					return;
				}
				//console.log('    heartbeat - ' + serverId);
				if (!g.isset(g.sockets[serverId])) {
					g.debug('Server {0} connected'.format(serverId));
					// new server connected
					servers[serverId] = { ready: false, queue: [ ] };
					// request socket states from server
					console.log('    >> {0} get-connected-sockets'.format(serverId));
					var p = {
						from: uuid, subject: 'cmd', body: 'get-connected-sockets'
					};
					writer.publish(serverId + '-inbox', JSON.stringify(p));
					setTimeout(function () { self.checkIfServerActive(serverId); }, activeInterval);
				}
				g.ackServerHeartbeat(serverId);
				break;
			case String(uuid) + '-inbox':
				var push    = JSON.parse(msg),
					from    = push.from,
					subject = push.subject,
					body    = push.body;
				switch (subject) {
					case 'cmd':
						if (body == 'get-connected-sockets') {
							//console.log('    << {0} get-connected-sockets'.format(from));
							var socs = { };
							if (g.isset(g.sockets[uuid])) { socs = g.sockets[uuid].connected; }
							var p = {
								from: uuid, subject: 'connected-sockets', body: socs,
							};
							writer.publish(from + '-inbox', JSON.stringify(p));
						} else {
							g.debug('warning - received unrecognized cmd {0} from server {1}'.format(body, from));							
						}
						break;
					case 'connected-sockets':
						var cnt = Object.keys(body).length;
						console.log('    << {0} got {1} clients'.format(from, cnt));
						if (!g.empty(g.sockets[from].connected)) {
							g.debug('Warning - g.sockets[serverId] is not empty but about to overwrite');
						}
						g.sockets[from].connected = body;
					    servers[from].ready = true;
					   	var event = servers[from].queue.pop();
					   	while (event != null) {
					   		_processSocketEvent(event);
					   		event = servers[from].queue.pop();
					   	}
						break;
					default:
						g.debug('warning - unknown subject ' + subject);
				}
				break;
			case 'soc-info':
				var obj = JSON.parse(msg),
				    serverId  = obj.uuid,
				    clientId  = obj.clientId,
				    sid       = obj.sid,
				    connected = obj.connected;
				// Ignore our own socket events
				if (serverId == uuid) {
					//var s = connected ? 'connected' : 'disconnected';
					//console.log('    ignoring socket event from us - {0} {1}'.format(clientId, s));
					return;
				}
				if (!g.isset(servers[serverId])) {
					// we're getting socket information but haven't received the server's heartbeat yet
					return;
				}
				if (!servers[serverId].ready) {
					servers[serverId].queue.push(obj);
					return;
				}
				_processSocketEvent(obj);
				break;
			case 'soc-action':
				var obj = JSON.parse(msg),
					slave  = obj.slave,
					master = obj.master;
				var sids = g.getSocketIds(uuid, slave);
				var joined = false;
				for (var i = 0; i < sids.length; i++) {
					var soc = g.io.sockets.connected[sids[i]];
					if (soc.ready) {
						joined = true;
						var room = g.roomTrackers(master);
						soc.join(room);
					}
				}
				if (joined) {
				    g.debug('    {0} joining {1}'.format(slave, room));
				}
				break;
			case 'soc-action-untrack':
				var obj  = JSON.parse(msg),
					slave  = obj.slave,
					master = obj.master;
				var sids = g.getSocketIds(uuid, slave);
				for (var i = 0; i < sids.length; i++) {
					var soc = g.io.sockets.connected[sids[i]];
					var room = g.roomTrackers(master);
					soc.leave(room);
				}
				g.debug('    {0} left {1}'.format(slave, room));
				break;
			default:
				g.debug('warning - msg event on unrecognized channel ' + channel);
		}
	});

	this.signaldeath = function () {
		writer.publish('sigint', uuid);
	};

	this.broadcastTrack = function (slave, master, b) {
		obj = {
			'slave': slave, 'master': master,
		}
		g.debug(b);
		if (b) {
			g.debug('here emitting untrack eevent');
			writer.publish('soc-action-untrack', JSON.stringify(obj));
		} else {
			writer.publish('soc-action', JSON.stringify(obj));
		}
	};

	client0.subscribe('sigint');
	client0.subscribe('node-heartbeat');
	client0.subscribe(String(uuid) + '-inbox');
	client0.subscribe('soc-info');
	client0.subscribe('soc-action');
	client0.subscribe('soc-action-untrack');

	var heartbeatInterval = 500; // ms
	this.beat = function () {
		//console.log('    heartbeat');
		writer.publish('node-heartbeat', uuid);
		setTimeout(function () { self.beat(); }, heartbeatInterval);
	};
	g.debug('Starting heartbeat every {0} ms'.format(heartbeatInterval));
	this.beat();
	return this;
};
