/**
 * @author
 * @copyright
 */
// Use that instead of this because context is variable based on how functions
// are invoked.
var that;
module.exports = {

  /** Global properties. **/

  server: null, // http.Server

  io    : null, // socket.io.Server

  redis : null, // node_redis

  // Map of user identifiers (uid: String) to WebSocket identifiers (sid: String)
  // e.g. sockets['500'] = '1a92be7';
  sockets: { },

  /** Helper functions. */

  /**
   * @return
   */
  toStr: function (obj) {
    return JSON.stringify(obj);
  },

  /**
   * @return
   */
  isset: function (obj) {
    return typeof obj !== 'undefined';
  },

  /**
   * @return
   */
  isEmpty: function (obj) {
    switch (typeof obj) {
      case 'undefined': return true;
      case 'number':    return obj == 0;
      case 'boolean':   return obj == false;
      case 'string':    return obj == '';
      case 'object':
        if (obj == null || obj.length === 0) {
          return true;
        }
        if (obj.length > 0) {
          return false;
        }
        // Speed up calls to hasOwnProperty
        var hasOwnProperty = Object.prototype.hasOwnProperty;
        for (key in obj) {
          if (hasOwnProperty.call(obj, key)) {
            return false;
          }
        }
        return true;
    }
  },

  /**
   * Use to dynamically create a global object.
   * @return The existing or newly created global object (singleton).
   */
  ns: function (str) {
    var parts = str.split('.');
    var obj = that;
    for (var i = 0; i < parts.length; i++) {
      var name = parts[i];
      if (!isset(obj[name])) {
        obj[name] = new Object();
      }
      obj = obj[name];
    }
    return obj;
  },
  
  /**
   * @return
   */
  getSocket: function (uid) {
    var sid = that.sockets[uid];
    if (!that.isEmpty(sid)) {
      return that.io.sockets.connected[sid];
    }
    return null;
  }
};
that = module.exports;
