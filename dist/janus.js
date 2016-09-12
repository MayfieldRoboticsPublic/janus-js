/**
 * Library used to communicate w/ Janus gateway using a `Janus.Session` and
 * `Janus.Plugin`.
 */

var Janus = Janus || {};

/**
 * Represents a connection (either http:// or ws://) to the Janus gateway
 * through which all non-WebRTC communication (e.g. signaling) is done by
 * `Janus.Session`. Use it like e.g.:
 *
 *   var cxn = new Janus.Connection({
 *       server: "http://",
 *       success: function () {
 *           console.log("connected!");
 *       },
 *   });
 *
 *   cxn.send({"message": "hi"}, {
 *       success: functon (data) {
 *           console.log("and janus said", data);
 *       }});
 *
 */
Janus.Connection = function (options) {
    this.server = options.server;
    this.session = options.session;
    this.options = {};
    this.ws = null;
    this.connected = false;

    _.defaults(options, {
        success: _.noop,
        error: _.noop
    });

    if (this.server.lastIndexOf("http://", 0) === 0) {
        this.options = _.defaults(_.pick(options), {
            pollTimeout: 60000,
            pollFrequency: 500,
            maxPollSize: 1,
            maxPollRetries: 3,
        });
        this._send = _.bind(this._httpSend, this);
        this._close = _.bind(this._httpClose, this);
        this._httpSetup(options);
    } else if (this.server.lastIndexOf("ws://", 0) === 0 || this.server.lastIndexOf("wss://", 0) === 0) {
        this.options = _.defaults(_.pick(options), {
            keepAliveFrequency: 30000,
        });
        this._send = _.bind(this._wsSend, this);
        this._close = _.bind(this._wsClose, this);
        this._wsSetup(options);
    } else {
        throw "Server '" + this.server + "' has unsupported scheme.";
    }
};

_.extend(Janus.Connection, Backbone.Events);

Janus.Connection.prototype.send = function (req, options) {
    var d = Q.defer();

    _.defaults(req, {
        "transaction": this.session.generateTransactionId(),
        "apisecret": this.session.secret
    });

    options = options || {};
    _.extend(options, {
        success: function (data) {
            d.resolve(data);
        },
        error: function (reason) {
            d.reject(reason);
        }
    });

    this._send(req, options);

    return d.promise;
};

Janus.Connection.prototype.close = function (options) {
    var d = Q.defer();

    options = options || {};
    _.extend(options, {
        success: function () {
            d.resolve();
        },
        error: function (reason) {
            d.reject(reason);
        }
    });

    this._close(options);

    return d.promise;
};

Janus.Connection.prototype._httpSetup = function (options) {
    var that = this,
        req = {
            "janus": "create",
            "transaction": this.session.generateTransactionId(),
            "apisecret": this.session.secret
        };

    options = options || {};

    return $.ajax({
        type: "POST",
        url: this.server + "/janus",
        async: true,
        cache: false,
        contentType: "application/json",
        data: JSON.stringify(req),
        dataType: "json",
        success: function (json) {
            that.connected = true;
            options.success(json.data);
            that._httpPoll();
        },
        error: function (XMLHttpRequest, textStatus, errorThrown) {
            var reason = textStatus + " - " + errorThrown;

            that.connected = false;
            options.error(reason);
        },
    });
};

Janus.Connection.prototype._httpPoll = function (retries) {
    if (!this.connected) {
        return;
    }

    var that = this,
        req = {
            "apisecret": this.session.secret,
        },
        params = {
            rid: new Date().getTime()
        };

    if (this.options.maxPolled) {
        params.maxev = this.options.maxPolled;
    }

    retries =  retries || 0;

    return $.ajax({
        type: "GET",
        url: this.session.url(params),
        data: JSON.stringify(req),
        dataType: "json",
        cache: false,
        timeout: this.options.pollTimeout,
        success: function (json) {
            if (that.connected) {
                setTimeout(_.bind(that._httpPoll, that, 0), that.options.pollFrequency);
            }
            that.session.handleEvent(json);
        },
        error: function (xhr, textStatus, errorThrown) {
            // retry
            retries++;
            if(retries < that.options.maxPollRetries) {
                setTimeout(_.bind(that._httpPoll, that, retries), that.options.pollFrequency);
                return;
            }

            // disconnect
            if (that.connected) {
                if (xhr.status === 0) {
                    that.session.trigger(
                        "janus:error",
                        "connection",
                        "Could not connect to the gateway " + retries + "x. Is it down?"
                    );
                }
                else {
                    that.session.trigger(
                        "janus:error",
                        "connection",
                        "Gateway rejected connnection " + retries + "x. Try reconnecting."
                    );
                }
                that.session.handleDisconnect();
            }
        },
    });
};

Janus.Connection.prototype._httpSend = function (req, options) {
    var that = this,
        url = options.plugin ? options.plugin.url() : this.session.url();

    _.defaults(options, {
        sync: false,
        type: "POST",
    });

    if (options.success) {
        that.session.transactions[req.transaction] = options.success;
    }

    return $.ajax({
        type: options.type,
        url: url,
        async: !options.sync,
        cache: false,
        contentType: "application/json",
        data: JSON.stringify(req),
        dataType: "json",
        success: function (json) {
            that.session.handleEvent(json);
        },
        error: function (XMLHttpRequest, textStatus, errorThrown) {
            if (req.transaction in that.session.transactions)
                delete that.session.transactions[req.transaction];
            if (options.error) {
                var reason = textStatus + " - " + errorThrown;
                options.error(reason);
            }
        },
    });
};

Janus.Connection.prototype._httpClose = function (options) {
    var req = {
            "janus": "destroy",
        };
    this.connected = false;
    return this.send(req, options);
};

Janus.Connection.prototype._wsSetup = function (options) {
    var that = this,
        ws = new WebSocket(this.server, "janus-protocol");

    ws.onclose = function (event) {
        that.connected = false;
        if (that.session.cxn === that)
            that.session.handleDisconnect();
        if (that._ws) {
            that._ws.close();
            that._ws = null;
        }
    };

    ws.onerror = function (event) {
    };

    ws.onmessage = function (event) {
        var json = JSON.parse(event.data);
        that.session.handleEvent(json);
    };

    ws.onopen = function (event) {
        that.connected = true;
        that._wsKeepAlive();
        that.send({ "janus": "create" }).then(function (data) {
            options.success(data);
        });
    };

    this._ws = ws;
};

Janus.Connection.prototype._wsSend = function (req, options) {
    if (options.success) {
        this.session.transactions[req.transaction] = options.success;
    }
    if (this.session.get("id")) {
        req.session_id = this.session.get("id");
    }
    if (options.plugin && options.plugin.get("id")) {
        req.handle_id = options.plugin.get("id");
    }
    console.log(req);
    return this._ws.send(JSON.stringify(req));
};

Janus.Connection.prototype._wsKeepAlive = function () {
    if (!this.connected) {
        console.info("exiting keep-alive loop");
        return;
    }
    if (this.session.get("id")) {
        this.send({ "janus": "keepalive" });
    }
    setTimeout(_.bind(this._wsKeepAlive, this), this.options.keepAliveFrequency);
};

Janus.Connection.prototype._wsClose = function (options) {
    if (this._ws) {
        this._ws.close();
        this._ws = null;
    }
    this.connected = false;
    _.defer(options.success);
};

/**
 * A `Backbone.Model` used to represent a Janus plugin to be `attach`-ed to a
 * `connect`-ed `Janus.Session`. Use it like e.g.:
 *
 *    MyPlugin = Janus.Plugin.extend({
 *        ...
 *    });
 *
 *    var myPlugin = new MyPlugin();
 *
 *    myPlugin.listenTo(janusSession, "janus:connect", function () {
 *        janusPlugin.attach(janusSession);
 *    });
 *
 */
Janus.Plugin = Backbone.Model.extend({

    defaults: {
        id: null,
        sdp: null,
        sdpSent: false,
        pc: null,
        dataChannel: null,
        iceTrickle: true,
        iceDone: false,
        localStream: null,
        media: {
            audioRecv: false,
            audioSend: false,
            videoRecv: false,
            videoSend: false,
            data: false
        }
    },

    url: function() {
        return this.session.url() + "/" + this.get("id");
    },

    isAttached: function () {
        return this.session !== undefined && this.session !== null && this.get("id") !== null;
    },

    attach: function (session) {
        var that = this,
            req = {
                "janus": "attach",
                "plugin": this.get("name")
            };

        return session.cxn.send(req).then(
            function (data) {
                that.session = session;
                that.set("id", data.id);
                console.info("attached plugin '" + that.get("id") + "' to session '" + that.session.get("id") + "'");
                that.session.plugins[that.get("id")] = that;
                that.trigger("janus:attach");
                that.session.trigger("janus:attach", that);
                return Q.fcall(function () { return data; });
            },
            function (reason) {
                that.session = null;
                that.session.trigger("janus:error", "attach", reason);
            }
        );
    },

    detach: function () {
        if (!this.isAttached()) {
            var d = Q.defer();

            _.defer(function () {
                that.handleDetach();
                d.resolve();
            });

            return d.promise;
        }

        var that = this,
            req = {
                plugin: this,
                "janus": "detach"
            };

        return this.session.cxn.send(req).then(
            function (data) {
                console.info("janus-detach: ", data);
                that.handleDetach();
                return Q.fcall(function () { return data; });
            },
            function (reason) {
                console.error("janus-detach failed:", reason);
                that.handleDetach();
            }
        );
    },

    handleDetach: function () {
        var session = this.session;

        if (session !== undefined && session !== null) {
            if (this.get("id") in session.plugins) {
                delete session.plugins[this.get("id")];
            }
            this.trigger("janus:detach");
            session.trigger("janus:detach", this);
            this.session = null;
        }
        this.set("id", null);
        this.hangupPeerConnection();
    },

    getUserMedia: function () {
        var that = this,
            d = Q.defer();

        function success(stream) {
            console.info("webrtc: getUserMedia", stream);
            that.set("localStream", stream);
            that.trigger("webrtc:localstream", stream);
            d.resolve(stream);
        }

        function error(reason) {
            console.error("webrtc: getUserMedia failed", error);
            d.reject(reason);
        }

        MediaStreamTrack.getSources(function (sources) {
            var audioExist = sources.some(function (source) { return source.kind === "audio"; }),
                videoExist = sources.some(function (source) { return source.kind === "video"; }),
                userMediaConstraints = {
                    audio: audioExist && that.isAudioSendEnabled(),
                    video: videoExist && that.isVideoSendEnabled()
                };

            getUserMedia(userMediaConstraints, success, error);
        });

        return d.promise;
    },

    createPeerConnection: function (options) {
        options = options || {};

        var that = this,
            d = Q.defer();

        if (!this.get("localStream") && (this.isAudioSendEnabled() || this.isVideoSendEnabled())) {
            return this.getUserMedia()
                .then(
                    function (stream) { return that.createPeerConnection(options); },
                    function (reason) { d.reject(reason); }
                )
                .then(
                    function (pc) { d.resolve(pc); },
                    function (reason) { d.reject(reason); }
                );
        }

        var pc = new RTCPeerConnection({
                iceServers: this.session.iceServers
            },
            this.session.pcConstraints
        );
        this.set("pc", pc);

        if (this.get("localStream")) {
            console.info("webrtc: local stream", this.get("localStream"));
            pc.addStream(this.get("localStream"));
        }

        pc.onaddstream = function (event) {
            console.debug("webrtc: remote stream", event);
            that.trigger("webrtc:remotestream", event);
        };

        if (this.isDataEnabled()) {
            var dataChannel = pc.createDataChannel("janus", {
                ordered: false
            });
            dataChannel.onmessage = function (event) {
                that.trigger("webrtc:datachannel:message", event.data);
            };
            dataChannel.onopen = function (event) {
                that.trigger("webrtc:datachannel:opened");
            };
            dataChannel.onclose = function (event) {
                that.trigger("webrtc:datachannel:closed", event.data);
            };
            dataChannel.onerror = function (event) {
                that.trigger("webrtc:datachannel:error", event);
            };
            this.set("dataChannel", dataChannel);
        }

        pc.ondatachannel = function(event) {
            console.debug("webrtc: remote data channel", event);
            that.trigger("webrtc:datachannel", event);
        };

        pc.onicecandidate = function (event) {
            if (event.candidate) {
                // just send it
                console.debug("webrtc: local ice candidate", event);
                var candidate = {
                    "candidate": event.candidate.candidate,
                    "sdpMid": event.candidate.sdpMid,
                    "sdpMLineIndex": event.candidate.sdpMLineIndex
                };
                that.sendIceCandidate(candidate);
                that.trigger("webrtc:icecandidate", event);
                return;
            }
            console.debug("webrtc: all local ice candidates have been generated");
            that.set("iceDone", true);
            if (that.get("iceTrickle")) {
                that.sendIceCandidate({"completed": true});
            } else {
                that.trigger("webrtc:icecomplete");
            }
        };

        _.defer(function () { d.resolve(pc); });

        return d.promise;
    },

    hangupPeerConnection: function () {
        if (this.get("localStream")) {
            console.debug("webrtc: stopping local stream");
            this.get("localStream").stop();
        }
        if (this.get("pc")) {
            console.debug("webrtc: closing peer connection");
            this.get("pc").close();
        }
        console.debug("webrtc: resetting state");
        this.set("sdp", null);
        this.set("sdpSent", false);
        this.set("pc", null);
        this.set("dataChannel", null);
        this.set("iceDone", false);
        this.set("localStream", null);
        this.trigger("webrtc:hangup");
    },

    hasDataChannel: function () {
        return this.get("dataChannel") !== null;
    },

    sendData: function (data) {
        console.debug("sending data through channel '" + this.get("dataChannel").label + "': ", data);
        this.get("dataChannel").send(data);
    },

    sendMessage: function (message, options) {
        var that = this,
            d = Q.defer(),
            req = {
                "janus": "message",
                "body": message,
            };

        options = options || {};
        _.defaults(options, { plugin: this });

        if (options.jsep !== null && options.jsep !== undefined)
            req.jsep = options.jsep;
        else if (this.get("sdp") && !this.get("sdpSent"))
            req.jsep = this.get("sdp");

        this.session.cxn.send(req, options).then(
            function (data) {
                if (req.jsep)
                    that.set("sdpSent", true);
                d.resolve(data);
            },
            function (reason) {
                d.reject(reason);
            }
        );

        return d.promise;
    },

    sendIceCandidate: function (candidate, options) {
        var that = this,
            d = Q.defer(),
            req = {
                "janus": "trickle",
                "candidate": candidate !== null ? candidate : {"completed": true}
            };

        function success(data) {
            d.resolve();
        }

        function error(reason) {
            d.reject(reason);
        }

        options = options || {};
        _.defaults(options, { plugin: this });

        this.session.cxn.send(req, options);

        return d.promise;
    },

    createOffer: function () {
        var that = this,
            d = Q.defer(),
            mediaConstraints = {
                mandatory: {
                    OfferToReceiveAudio: this.isAudioRecvEnabled(),
                    OfferToReceiveVideo: this.isVideoRecvEnabled()
                }
            };

        function success(offer) {
            console.log("webrtc: created offer", offer);
            if (that.get("sdp") === null || that.get("sdp") === undefined) {
                console.log("webrtc: set local description", offer);
                that.set("sdp", {
                    type: "offer",
                    sdp: offer.sdp
                });
                that.get("pc").setLocalDescription(offer);
            }
            that.trigger("webrtc:offer", offer);
            d.resolve(offer);
        }

        function error(reason) {
            console.log("webrtc: failed to create offer", reason);
            d.reject(reason);
        }

        console.log("webrtc: create offer", mediaConstraints);
        this.get("pc").createOffer(success, error, mediaConstraints);

        return d.promise;
    },

    createAnswer: function () {
        var that = this,
            d = Q.defer();
            mediaConstraints = {
                "mandatory": {
                    "OfferToReceiveAudio": this.isAudioRecvEnabled(),
                    "OfferToReceiveVideo": this.isVideoRecvEnabled()
                }
            };

        function success(answer) {
            console.log("webrtc: created answer", answer);
            if (that.get("sdp") === null || that.get("sdp") === undefined) {
                console.log("webrtc: set local description to", answer);
                that.set("sdp", {
                    "type": "answer",
                    "sdp": answer.sdp
                });
                that.get("pc").setLocalDescription(answer);
            }
            that.trigger("webrtc:answer", answer);
            d.resolve(answer);
        }

        function error(reason) {
            console.log("webrtc: failed to create answer", reason);
            d.reject(reason);
        }

        console.log("webrtc: create answer", mediaConstraints);
        this.get("pc").createAnswer(success, error, mediaConstraints);

        return d.promise;
    },

    handleEvent: function (data, jsep) {
        var that = this;

        if (jsep) {
            if (!this.get("pc")) {
                this.createPeerConnection().then(function (pc) {
                    that.setRemoteDescription(jsep);
                });
            } else {
                this.setRemoteDescription(jsep);
            }
        }
        this.trigger("janus:event", data, jsep);
    },

    setRemoteDescription: function (description) {
        var that = this,
            d = Q.defer();

        if (!(description instanceof RTCSessionDescription)) {
            description = new RTCSessionDescription(description);
        }

        function success() {
            console.log("webrtc: accepted remote description", description);
            if (description.type == "offer") {
                that.createAnswer();
            }
            d.resolve(description);
        }

        function error(reason) {
            console.log("webrtc: rejected remote description", reason);
            d.reject(reason);
        }

        console.log("webrtc: setting remote description", description);
        this.get("pc").setRemoteDescription(description, success, error);

        return d.promise;
    },

    isAudioSendEnabled: function (media) {
        if (arguments.length === 0)
            media = this.get("media");
        if(media === undefined || media === null)
            return true;
        if(media.audio === false)
            return false;
        if(media.audioSend === undefined || media.audioSend === null)
            return true;
        return (media.audioSend === true);
    },

    isAudioRecvEnabled: function (media) {
        if (arguments.length === 0)
            media = this.get("media");
        if(media === undefined || media === null)
            return true;
        if(media.audio === false)
            return false;
        if(media.audioRecv === undefined || media.audioRecv === null)
            return true;
        return (media.audioRecv === true);
    },

    isVideoSendEnabled: function (media) {
        if (arguments.length === 0)
            media = this.get("media");
        if(media === undefined || media === null)
            return true;
        if(media.video === false)
            return false;
        if(media.videoSend === undefined || media.videoSend === null)
            return true;
        return (media.videoSend === true);
    },

    isVideoRecvEnabled: function (media) {
        if (arguments.length === 0)
            media = this.get("media");
        if(media === undefined || media === null)
            return true;
        if(media.video === false)
            return false;
        if(media.videoRecv === undefined || media.videoRecv === null)
            return true;
        return (media.videoRecv === true);
    },

    isDataEnabled: function (media) {
        if (arguments.length === 0)
            media = this.get("media");
        if(media === undefined || media === null)
            return true;
        return media.data === true;
    },

    attached: function () {
        var that = this,
            d = Q.defer();

        function callback() {
            that.off(null, callback);
            d.resolve();
        }

        _.defer(function () {
            if (that.isAttached()) {
                callback();
                return;
            }
            that.once("janus:attach", callback);
        });

        return d.promise;
    },

    negotiated: function () {
        var that = this,
            d = Q.defer();

        function callback() {
            that.off(null, callback);
            d.resolve();
        }

        _.defer(function () {
            if (that.get("sdp")) {
                callback();
                return;
            }
            that.once("webrtc:offer", callback);
            that.once("webrtc:answer", callback);
        });

        return d.promise;
    }
});

/**
 * A `Backbone.Model` used to represent a Janus gateway connection. All non-WebRTC
 * communication (i.e. http:// or ws:// events) with the gateway is coordinated by
 * `Janus.Session ` and WebRTC is done by `Janus.Plugin`s. Use it like e.g.:
 *
 *    var janusSession = new Janus.Session({}, {
 *        urlRoot: "http://127.0.0.1:8088/janus",
 *        iceServers: [{
 *            url: navigator.mozGetUserMedia ? "stun:stun.services.mozilla.com" :
 *                 navigator.webkitGetUserMedia ? "stun:stun.l.google.com:19302" :
 *                 "stun:23.21.150.121"
 *        }],
 *        pcConstraints: {
 *            "optional": [{"DtlsSrtpKeyAgreement": true}]
 *        }
 *    });
 *
 *    janusSession.connect();
 *
 */
Janus.Session = Backbone.Model.extend({

    defaults: {
        id: null,
    },

    initialize: function (attributes, options) {
        var that = this;
        this.cxnConfig = {
            server: options.urlRoot
        };
        this.cxn = null;
        this.secret = options.secret;
        this.transactions = {};
        this.plugins = {};
        this.iceServers = options.iceServers || [];
        this.pcConstraints = options.pcConstraints || null;
    },

    url: function (params) {
        return (
            this.cxnConfig.server +
            "/janus" +
             "/" + this.get("id") +
            (params ? "?" + $.param(params) : "")
        );
    },

    connect: function (options) {
        var that = this,
            cxn = null,
            d = Q.defer();

        function success(data) {
            console.log("create session", data);
            that.cxn = cxn;
            that.set("id", data.id);
            console.log("created session w/ id " + that.get("id"));
            that.trigger("janus:connect");
            d.resolve(cxn);
        }

        function error() {
            console.error("create session", reason);
            that.cxn = null;
            that.trigger("janus:error", "connect", reason);
            d.reject(reason);
        }

        options = options || {};
        _.extend(options, this.cxnConfig);
        _.extend(options, {
            session: this,
            success: success,
            error: error
        });

        if (this.isConnected()) {
            _.defer(function () { d.resolve(); });
        } else {
            cxn = new Janus.Connection(options);
        }

        return d.promise;
    },

    isConnected: function () {
        return this.cxn !== null;
    },

    disconnect: function (options) {
        var p, that = this;

        if (!this.isConnected()) {
            var d = Q.defer();
            _.defer(function () {
                d.resolve();
            });
            p = d.promise;
        } else {
            p = this.cxn.close();
        }

        p.then(
            function () {
                that.handleDisconnect();
            },
            function () {
                that.handleDisconnect();
            }
        );

        return p;
    },

    reconnect: function (options) {
        var that = this;

        options = _.extend(options || {}, this.cxnConfig);

        return this.disconnect().then(
            function () {
                return that.connect(options);
            },
            function () {
                return that.connect(options);
            }
        );
    },

    generateTransactionId: function () {
        return _.sample("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 12).join("");
    },

    handleDisconnect: function () {
        var id = this.get("id");

        this.cxn = null;
        this.set("id", null);
        _.each(_.values(this.plugins), function (plugin) {
            plugin.handleDetach();
        });
        this.plugins = {};
        this.transactions = {};

        this.trigger("janus:disconnect", id);
    },

    handleEvent: function (json) {
        if (_.isArray(json)) {
            _.each(json, this.handleEvent);
            return;
        }

        console.log("event for session " + this.get("id"), json);

        var that = this,
            sender = json.sender,
            jsep = json.jsep,
            plugin,
            pluginData,
            data,
            error;

        function callback(transaction) {
            if(transaction in that.transactions) {
                var func = that.transactions[transaction];
                delete that.transactions[transaction];
                return func;
            }
            return _.noop;
        }

        switch (json.janus) {
            case "success":
                pluginData = json.plugindata;
                if(pluginData === undefined || pluginData === null) {
                    callback(json.transaction)(json.data);
                } else {
                    console.info("event from " + sender + " (" + pluginData.plugin + ")");
                    callback(json.transaction)(pluginData.data);
                }
                break;
            case "error":
                error = "error" in json ? json.error : json;
                console.error("oops: " + error.code + " " + error.reason);
                callback(json.transaction)(error);
                break;
            case "keepalive":
                break;
            case "ack":
                break;
            case "webrtcup":
                break;
            case "hangup":
                plugin = this.plugins[sender];
                if (plugin === undefined || plugin === null) {
                    console.info("no plugin for sender '" + sender + "'");
                    break;
                }
                plugin.detach();
                break;
            case "detached":
                plugin = this.plugins[sender];
                if (plugin === undefined || plugin === null) {
                    console.info("no plugin for sender '" + sender + "'");
                    break;
                }
                plugin.detach();
                break;
            case "event":
                if (sender === undefined || sender === null) {
                    console.warn("missing sender");
                    break;
                }
                pluginData = json.plugindata;
                if(pluginData === undefined || pluginData === null) {
                    console.warn("missing plugindata");
                    return;
                }
                console.info("event from " + sender + " (" + pluginData.plugin + ")");
                data = pluginData.data;
                plugin = this.plugins[sender];
                if(plugin === undefined || plugin === null) {
                    console.info("no plugin for sender '" + sender + "'");
                    break;
                }
                if (jsep !== undefined && jsep !== null) {
                    console.info("... and it came w/ SDP", jsep);
                }
                plugin.handleEvent(data, jsep);
                callback(json.transaction)(data, jsep);
                break;
            default:
                console.warn("unknown event '" + json.janus + "', ignoring ...");
                break;
        }
    },

    findPlugin: function (predicate) {
        var key = _.findKey(this.plugins, predicate);
        if (key !== undefined) {
            return this.plugins[key];
        }
    }
});
