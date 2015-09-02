/**
 * @author
 * @copyright
 */
var mysql = require('mysql'),
    conf  = require('./private-NO-COMMIT.js');
// TODO: consider refactoring this file into separate daos
module.exports = function (e) {
	
	return new (function (env) {

		this.ERROR_CODES = {

		};

		this.ACQUIRE_TIMEOUT  = 10000; // Max milliseconds to acquire connection from pool. Different from CONNECT_TIMEOUT
								       // because acquiring a connection doesn't always involve actually connecting.

		this.CONNECTION_LIMIT = 100;   // Maximum # of connections to create at once.
	
		this.DB_BENTO = 'bento';
	
		// XXX: https://codeforgeek.com/2015/01/nodejs-mysql-tutorial/
		var _conf = conf[env].mysql;
		
		var _pool = mysql.createPool({
	  		connectionLimit: this.CONNECTION_LIMIT,
	  		host: _conf.host,
	  		port: _conf.port,
	  		user: _conf.username,
	  		password: _conf.password,
	  		database: this.DB_BENTO,
	  		debug: false,//true,
	  		queueLimit: 0,
		});
		
		console.log('Instantiating database connection pool as ' + _conf['username'] + '@' + _conf['host'] + ':' + _conf['port']);

		this.exec = function (sql, callback) {
			console.log(sql);
			// XXX: https://github.com/felixge/node-mysql/
			_pool.query(sql, function (err, rows, fields) {
				if (err) {
					console.log('Error fetching data from database - ' + err.message);
					callback(null);
				} else {
					// rows is an array of objects where each object is a single row and the keys
					// are the fields
					// rows = [
					callback(rows);
				}
			});
		};
	})(e);
}
