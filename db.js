/**
 * @author
 * @copyright
 */
var g     = require('./global.js'),
	conf  = require('./private-NO-COMMIT.js');
	mysql = require('mysql'),

// see https://codeforgeek.com/2015/01/nodejs-mysql-tutorial/
module.exports = function (env) {

	var _conf = conf[env].mysql;
	
	g.debug('Instantiating database connection pool as ' + _conf['username'] + '@' + _conf['host'] + ':' + _conf['port']);
	
	var _pool = mysql.createPool({
		connectionLimit: 100, // max # of connections created
		host: _conf.host,
		port: _conf.port,
		user: _conf.username,
		password: _conf.password,
		database: 'bento',
		debug: false,//true,
		queueLimit: 0,
		//acquireTimeout: 5000,
		//connectTimeout: 5000,
	});

	_pool.getConnection(function (err, con) {
		if (err) {
			throw new Error('Error connecting to database - ' + err);
		}
		g.debug('Connected to database');
		con.release();
	});

	function Table(name, overrides) {
		this.name = name;
		this.colUsername = 'email';
		this.colPassword = 'password';
		this.colToken = 'api_token';
		// overrides
		for (property in overrides) {
			if (overrides.hasOwnProperty(property)) {
				this[property] = overrides[property];
			}
		}
	}

	Table.prototype.getToken = function (pk, callback) {
		var sql = 'select {0} as token from {1} where pk_{1}={2}'
			.format(this.colToken, this.name, pk);
		//g.debug(sql);
		_pool.query(sql, function (err, rows, fields) {
			if (err) {
				g.error('Error fetching token from database - ' + err);
				callback(null);
			} else {
				callback(rows);
			}
		});
	}

	Table.prototype.updateToken = function (pk, token, callback) {
		var sql = "update {0} set {1}='{2}' where pk_{0}={3}"
			.format(this.name, this.colToken, token, pk);
		//g.debug(sql);
		_pool.query(sql, function (err, rows, fields) {
			if (err) {
				g.error('Error updating token - ' + err);
				callback(null);
			} else {
				callback(rows);
			}
		});
	}

	Table.prototype.getAuth = function (username, callback) {
		var sql = "select pk_{0} as pk, {1} as username, {2} as password, {3} as api_token from {0} where {1}='{4}'"
			.format(this.name, this.colUsername, this.colPassword, this.colToken, username);
		//g.debug(sql);
		// see https://github.com/felixge/node-mysql/
		_pool.query(sql, function (err, rows, fields) {
			if (err) {
				g.error('Error fetching data from database - ' + err.message);
				callback(null);
			} else {
				callback(rows);
			}
		});
	};

	return {
		customer: new Table('User'),
		driver: new Table('Driver'),
		admin: new Table('admin_User', { colUsername: 'username' }),
		system: new Table('api_User', { colUsername: 'api_username', colPassword: 'api_password' }),
		/*
		exec: function (sql, callback) {
			//console.log(sql);
			// XXX: https://github.com/felixge/node-mysql/
			_pool.query(sql, function (err, rows, fields) {
				if (err) {
					console.log('Error fetching data from database - ' + err.message);
					callback(null);
				} else {
					// rows is an array of objects where each object is a single row and the keys
					// are the fields
					// rows = [
					//console.log(rows);
					callback(rows);
				}
			});
		},
		*/
	};
}
