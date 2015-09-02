/**
 * @author
 * @copyright
 */
var g    = require('./global.js'),
    push = require('./push.js'),
    url  = require('url'),
    bcrypt = require('bcrypt');
var that;
module.exports = {

  /**
   * API response object.
   * @param code (number) 0 - success, otherwise error
   *        msg  (string) Empty if success, otherwise an error message
   *        ret  (?)      The return value (can be a primitive or an object)
   */
  _res: function (code, msg, ret) {
    return {
      'code': code, 'msg': msg, 'ret': ret,
    };
  },
  
  _success: function (ret) {
    return that._res(0, '', ret);
  },
  
  _error: function (code, msg) {
    return that._res(code, msg, null);
  },
  
  _requestFilters: {
    //'/api/push': [],
  },
  
  is_valid: function (req) {
    var urlParts = url.parse(req.url, true);
    var filters = that._requestFilters[urlParts.pathname];
    // Do something here.
    return true;
  },

  WS_STAT: 'stat',

  notify_status: function (clientId, status) {
    g.redis.SMEMBERS(that._cacheKeySubscribers(clientId), function (err, ret) {
      if (err) {
        console.log('Error: notify_status - ' + err);
      } else {
        for (var i = 0; i < ret.length; i++) {
          var soc = g.getSocket(ret[i]);
          if (!g.isEmpty(soc) & soc.connected) {
            var obj = {
              'clientId': clientId,
              'status': status,
            }
            soc.emit(that.WS_STAT, JSON.stringify(obj));
          }
        }
      }
    });
  },

    // TODO: Make stronger
    gen_token: function () {
        var token = '';
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (var i = 0; i < 64; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    },

    // TODO: Implement time-constant token validation.
    verify_token: function (uid, token) {
        // XXX: Need to check expiryTs
        return g['tokens'][uid]['token'] === token;
    },

    /**
     * @return
     */
    '/api/authenticate': function (params, fn) {
        // TODO: protect against sql injection attacks.
        var sql = "SELECT api_password FROM api_User WHERE email='" + params['username'] + "'";
        console.log('Retrieving authentication information for ' + params['uid']);
        g.mysql.exec(sql, function (res) {
            if (res == null) {
                fn(that._error(1, 'Database error during authentication.'));
            } else if (res.length >= 0 && !g.empty(res[0]['api_password'])) {
                var hash = res[0]['api_password'];
                // Async compare using bcyrpt
                bcrypt.compare(params['password'], hash, function (err, res) {
                    if (err) {
                        // error with bcrypt
                        var msg = 'Error with bcrypt - ' + err;
                        console.log(msg);
                        fn(that._error(1, msg));
                    } else if (res) {
                        // Good - generate API token here
                        var ret = {
                            'token': that.gen_token(), 'expiryTs': -1,
                        };
                        fn(that._success(ret));
                    } else {
                        fn(that._error(401, 'Bad authentication credentials.'));
                    }
                });
            }
        });
    },
  
  /** Push notifications **/ 

  '/api/push': function (params, fn) {    
    var target = JSON.parse(params['target']);
    if (target instanceof Array) {
      // Push notification to queue and schedule a pop.
      for (var i = 0; i < target.length; i++) {
        var p = {
          'origin' : params['uid'],
          'target' : target[i],
          'subject': params['subject'],
          'body'   : params['body'],
        };
        push.queue(target[i]+'', JSON.stringify(p));
      }
    }
    // TODO: Support * and group notifications.
    fn(that._success(''));
  },
  
  /** Geotracking **/
  
  WS_LOC: 'loc',
  _cacheKeyLatLng: function (uid) {
    return 'loc_' + uid + '.latlng';
  },
  _cacheKeySubscribers: function (uid) {
    return 'loc_' + uid + '.subscribers';
  },

  /**
   * Get (one time) the location of one or more clients.
   */
  '/api/gloc': function (params, fn) {
      // TODO
      fn(that._error(1, 'This API is currently not implemented.'));
  },
  /**
   * Update GPS location.
   * @param uid The user identifier of the client (customer or driver) whose
   *            location is to be updated. 
   * @param lng Longitude.
   * @param lat Latitude.
   */
  '/api/uloc': function (params, fn) {
    var uid = params['uid'],
        lat = params['lat'],
        lng = params['lng'],
        obj = {
          'lat': lat,
          'lng': lng,
        };
    // Update location in cache.
    g['redis'].SET(that._cacheKeyLatLng(uid), JSON.stringify(obj), function (err, ret) {
      if (err != null) {
        console.log('redis: ' + err);
        fn(that._error(1, err));
      } else {
        fn(that._success([]));
        // Then push loc update to all subscribers.
        g['redis'].SMEMBERS(that._cacheKeySubscribers(uid), function (err, ret) {
          if (err != null) {
            console.log('redis: ' + err);
          } else {
            for (var i = 0; i < ret.length; i++) {
              var soc = g.getSocket(ret[i]);
              if (!g.isEmpty(soc)) {
                obj.clientId = uid;
                soc.emit('loc', obj);
              }
            }
          }
        // g['redis'].SMEMBERS
        });
      }
    // g['redis'].SET
    });
  },

  '/api/track': function (params, fn) {
    var uid = params['uid'],
        clientId = params['clientId'];
    g['redis'].SADD(that._cacheKeySubscribers(clientId), uid, function (err, ret) {
      if (err != null) {
        console.log('redis: ' + err);
        fn(that._error(1, err));
      } else {
        var cSoc = g.getSocket(clientId);
        fn(that._success({
          connected: g.isEmpty(cSoc) ? false : cSoc.connected,
        }));
        // Then if there's any location data available, immediately send it.
        // XXX: Do not send stale location data. Maybe only send if client is online?
        g['redis'].GET(that._cacheKeyLatLng(clientId), function (err, ret) {
          if (err != null) {
            console.log('redis: ' + err);
          } else if (!g.isEmpty(ret)) {
            var soc = g.getSocket(uid);
            if (g.isset(soc)) {
              var obj = JSON.parse(ret);
              obj.clientId = clientId;
              soc.emit('loc', obj);
            }
          }
        // g['redis'].GET
        });
      }
      // g['redis'].SADD
    });
  },
};
that = module.exports;
