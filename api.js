/**
 * @author
 * @copyright
 */
var g = require('global'),
    push = require('push'),
    url = require('url');
var that;
module.exports = {
  
  _res: function (code, msg) {
    return JSON.stringify({
      'code': code, 'msg': msg,
    });
  },
  
  _success: function () {
    return that._res(0, '');
  },
  
  _requestFilters: {
    //'/api/push': [],
  },
  
  isValid: function (req) {
    var urlParts = url.parse(req.url, true);
    var fn = that._requestFilters[urlParts.pathname];
    return g.isset(fn) ? fn(req, urlParts) : true;
  },
  
  /** Push notifications **/ 
  
  '/api/push': function (req, res, params) {
    var target = JSON.parse(params['target']);
    var msg = params['msg'];
    if (target instanceof Array) {
      // Push notification to queue and schedule a pop.
      for (var i = 0; i < target.length; i++) {
        push.queue(target[i], msg);
      }
    }
    // TODO: Support * and group notifications.
    res.end(that._success);
  },
  
  /** Geotracking **/
  
  WS_LOC: 'loc',
  _cacheKeyLngLat: function (uid) {
    return 'loc_' + uid + '.lnglat';
  },
  _cacheKeySubscribers: function (uid) {
    return 'loc_' + uid + '.subscribers';
  },

  /**
   * Get (one time) the location of one or more clients.
   */
  '/api/gloc': function (req, res, params) {
      // TODO
      res.end('Currently not implemented');
  },
  /**
   * Update GPS location.
   * @param uid The user identifier of the client (customer or driver) whose
   *            location is to be updated. 
   * @param lng Longitude.
   * @param lat Latitude.
   */
  '/api/uloc': function (req, res, params) {
    var uid = params['uid'], lng = params['lng'], lat = params['lat'];
    var obj = {
      'lng': lng,
      'lat': lat
    };
    g['redis'].set(that._cacheKeyLngLat(uid), JSON.stringify(obj), function (err, ret) {
      res.end(that._success());
      // Then push update to all subscribers.
      g['redis'].SMEMBERS(that._cacheKeySubscribers(uid), function (err, ret) {
        for (var i = 0; i < ret.length; i++) {
          var soc = g.getSocket(ret[i]);
          if (g.isset(soc)) {
            soc.emit('loc', obj);
          }
        }
      });
    });
    
  },

  '/api/track': function (req, res, params) {
    var uid = params['uid'],
        clientId = params['clientId'];
    g['redis'].sadd(that._cacheKeySubscribers(clientId), uid, function (err, ret) {
      res.end(that._success());
      g['redis'].get(that._cacheKeyLngLat(clientId), function (err, ret) {
        if (!g.isEmpty(ret)) {
          var soc = g.getSocket(uid);
          if (g.isset(soc)) {
            var data = JSON.parse(ret);
            data.clientId = clientId;
            soc.emit('loc', data);
          }
        }
      });
    });
  },

};
that = module.exports;
