/**
 * @author
 * @copyright
 */
// Use "that" instead of "this" because context is variable based on how functions
// are invoked.
var that;
module.exports = {
    
    /* Global properties */

    server: null, // http.Server

    io    : null, // socket.io.Server

    redis : null, // node_redis

    mysql : null,

    // Map of user identifiers (uid) to WebSocket identifiers (sid)
    // e.g. sockets['500'] = '1a92be7';
    sockets: {

    },

    // Access tokens; automatically generated after successful authentication
    // See /api/authenticate
    tokens: {

    },

    /* Helper functions */

    /**
     * This is not a "toString" method!
     * @return
     */
    str: function (obj) {
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
    empty: function (obj) {
        switch (typeof obj) {
            case 'undefined': return true;
            case 'number'   : return obj == 0;
            case 'boolean'  : return obj == false;
            case 'string'   : return obj == '';
            case 'object':
                // 
                if (obj == null || obj.length === 0) {
                    return true;
                }
                //
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
            default:
                throw new Error('Unsupported type: ' + typeof obj);
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
        var sid = that.sockets[String(uid)];
        if (!that.empty(sid)) {
            return that.io.sockets.connected[sid];
        }
        return null;
    }
};
that = module.exports;
