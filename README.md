# janus-js [![Build Status](https://magnum.travis-ci.com/mayfieldrobotics/janus-js.svg?token=qHBoPmgQbWPVxfoYZkz1)](https://magnum.travis-ci.com/mayfieldrobotics/janus-js)

Javascript client for [janus](https://github.com/meetecho/janus-gateway).

## dev

```bash
$ git clone git@github.com:mayfieldrobotics/janus-js.git
$ cd janus-js
$ npm install
$ grunt build test
```

## deps

From `bower.json`:

* [backbone](http://backbonejs.org/)
* [underscore](http://underscorejs.org/)
* [jquery](http://jquery.com/)
* [q](https://github.com/kriskowal/q)

## install

```bash
$ bower install janus --save
```

or:

```bash
$ bower install janus=git@github.com:mayfieldrobotics/janus-js.git#master --save
```

## usage

Define a nice way to talk to your plugin by extending `Janus.Plugin`, e.g:

```js
MyRecordPlugin = Janus.Plugin.extend({

    initialize : function(attributes, options) {
        this.set("name", "janus.plugin.myrecord");
        
        options = options || {};
        
        var media = {
            data: true
        };
        if (options.publish) {
            _.extend(media, {
                audioSend: true,
                videoSend: true
            });
        }
        if (options.subscribe) {
            _.extend(media, {
                audioRecv: true,
                videoRecv: true
            });
        }
        _.extend(this.get("media"), media);
    },

    publish: function(stream, options) {
        var body = {
                request: "join",
                type: "publisher",
                name: stream,
            };
        
        _.extend(body, _.pick(options,
                "record",
                "record_rotate_freq",
                "audio",
                "video",
                "bitrate"
            ));
        
        this.set("stream", stream);
        
        return this.sendMessage(body);
    },

    subscribe: function (name, publisher, options) {
        var body = {
                request: "join",
                type: "subscriber",
                name: name,
                publisher: publisher,
            };
        _.extend(body, _.pick(options, "paused"));
        return this.sendMessage(body);
    },
    
    configure: function (options) {
        var body = {
                request: "configure"
            };
        _.extend(body, _.pick(options,
            "record",
            "record_rotate_freq",
            "audio",
            "video",
            "bitrate",
            "paused"
        ));
        return this.sendMessage(body);
    },
    
    sessions: function () {
        var body = {
            request : "list"
        };
        return this.sendMessage(body);
    },
    
    leave: function () {
        var body = {
            request : "leave"
        };
        return this.sendMessage(body);
    }
});
```

then create a `Janus.Session`:

```js
var janusSession = new Janus.Session({}, {
    urlRoot: "ws://127.0.0.1:8118",
    secret: "janusrocks",
    iceServers: [{
        "url":"stun:stun.l.google.com:19302"
    }],
    pcConstraints: {
        "optional": [{"DtlsSrtpKeyAgreement": true}]
    }
});
```

attach your plugin to it:

```js
var janusPlugin = new MyRecordPlugin(null, {
    publish: false,
    subscribe: true
});

janusSession.connect()
    .then(function () {
        return janusPlugin.attach(janusSession);
    })
    .then(function () {
        return janusPlugin.createPeerConnection();
    })
    .then(function () {
        return janusPlugin.createOffer();
    })
    .then(function () {
        return janusPlugin.subscribe("subscriber-id", "publisher-id");
    });
```

and use it:

```js
janusPlugin.configure({
    audio: false,
    video: true,
    bitrate: 1024
});
```

## events

**TODO**
