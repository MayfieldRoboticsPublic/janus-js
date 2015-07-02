# janus-js [![Build Status](https://magnum.travis-ci.com/mayfieldrobotics/janus-js.svg?token=qHBoPmgQbWPVxfoYZkz1)](https://magnum.travis-ci.com/mayfieldrobotics/janus-js)

Javascript client for [janus](https://github.com/meetecho/janus-gateway) that hopefully **doesn't totally suck**:tm:.

## dev

```bash
$ git clone git@github.com:mayfieldrobotics/janus-js.git
$ cd janus-js
$ npm install
$ grunt build test
```

## usage

Install it, e.g.:

```bash
$ bower install janus-js=git@github.com:mayfieldrobotics/janus-js.git#master --save
```

and then use these two types:

* `Janus.Session` and
* `Janus.Plugin`
