!["FAILS logo"](failslogo.svg)
# Fancy automated internet lecture system (**FAILS**) - components (Webtransport module)

Linux tests on master ![master](https://github.com/fails-components/webtransport/actions/workflows/libtest-linux.yml/badge.svg?branch=master)

Windows tests on master ![master](https://github.com/fails-components/webtransport/actions/workflows/libtest-windows.yml/badge.svg?branch=master)

Macos tests on master ![master](https://github.com/fails-components/webtransport/actions/workflows/libtest-macos.yml/badge.svg?branch=master)

(c) 2022- Marten Richter

The package provides Webtransport support to node.js .

This package is part of FAILS.
A web-based lecture system developed out of university lectures.

While FAILS as a whole is licensed via GNU Affero GPL version 3.0, this package is licensed under a BSD-style license that can be found in the LICENSE file, while code taken from other projects is still under their respective license (see LICENSE file for details).
This package is licensed more permissive, since it can be useful outside of the FAILS environment.

This module is a C++ node binding to libquiche [https://github.com/google/quiche](https://github.com/google/quiche)(note there is a second library with a similar purpose and the same name), which provides besides other network protocols HTTP/3 support.
This packages currently only provides support for HTTP/3 WebTransport with an interface similar to the browser side (but not all features implemented), for server as well as for client, see `old_test/test.js`, `old_test/testsuite.js`, `old_test/echoclient.js`, `old_test/echoserver.js`  for examples.
Note, that the client implementation only supports certificate checking via certificateHashes, however experimental support for rootCA-based checking is introduced with version 1.0.0.
It may be possible in the future to also support normal HTTP/3 with not so much effort, however, there is no intention from the author to implement this since it will not be needed by FAILS. However, PR requests are welcome and will be supported by advice from the author.
The package should be considered as a duct tape-style solution until a bulletproof native support of HTTP/3 and WebTransport is provided by node itself.

If you need a ponyfill check out the sister package [https://github.com/fails-components/webtransport-ponyfill-websocket/](https://github.com/fails-components/webtransport-ponyfill-websocket/), which provides a mapping of the Webtransport interfaces to Websocket connections.

## Changes for Version 1.x.x

The interface for version 1.x.x is not changed compared to 0.x.x.
However, it was heavily internally rewritten. 
For example, the implementation does not use a separate event loop for quiche implementation anymore. Instead, it uses node.js native datagram sockets and the eventloop of node.js.
So even though not intended, the library may behave unintended differently in detail.


## Installation and usage
You can install the package directly via npm from node.js or GitHub packages:
In the case of GitHub packages, please add this to your `.npmrc`` file
```
@fails-components:registry=https://npm.pkg.github.com
```
In this case, you need to be authenticated against github.

The package provides prebuild binaries for `windows`, `linux` and `macos` for the platform `x64` and `ia32` (only Windows).
Other platforms may be possible via cross-compiling in the github actions, if someone needs this, PRs are welcome.

Of course, you can also build the binary on your system.
If you are running the compiling install as root, you need to use `--unsafe-perm` as flag.
Installing the package without prebuild requires a full building environment including clang-9, perl6, python, golang,  ninja-build, icu. See the `Dockerfile` or `Dockerfile.development` for required Debian packages.
This should work for Windows, Linux and Mac OS X.
(You may want to check out the building dependencies (especially for Windows) for BoringSSl, zlib, abseil on their respective websites).

Of course,  PR for patches and for compiling instructions and necessary changes are welcome for all possible environments.

** Warning the build time takes more than 15 minutes, on Windows even longer! (Due to the building of the third party libraries). **

In the directory `old_test` you find a simple echo server code. That answers to a series of WebTransport echos. Furthermore some example browser code and finally a unit test of the library including certificate generation.

When testing remember you might need to start Chromium based browser with certain flags to accept your http/3 certificate with errors, e.g.:
```
chrome --ignore-certificate-errors-spki-list=FINGERPRINTOFYOURCERTIFICATE --ignore-certificate-errors --v=2 --enable-logging=stderr --origin-to-force-quic-on=192.168.1.50:8080
```
of course replace IP and fingerprint of your certificate accordingly. However, the author never got this to work and is using this without flags, but supplies instead a fingerprint when opening a WebTransport session. (PRs welcome).

## Specification divergence

This module implements parts of the [WebTransport spec](https://datatracker.ietf.org/doc/html/draft-vvv-webtransport-quic-00) but not all of it.

The types from the [W3C Working Draft](https://www.w3.org/TR/webtransport/) have been added to [lib/dom.ts](https://github.com/fails-components/webtransport/blob/master/lib/dom.ts) but some fields are commented out.

These fields are unimplemented by this module at this time. Some may be implemented in the future, others are legacy fields that may be removed from the spec. PRs are welcome!

They are:

### WebTransport

* [getStats()](https://www.w3.org/TR/webtransport/#dom-webtransport-getstats)
* [reliability](https://www.w3.org/TR/webtransport/#dom-webtransport-reliability)

The WebTransport client only supports certification validation using fingerprints. Without a fingerprint, an experimental implementation checks the certificates against the root certificates integrated in node.

### WebTransportDatagramDuplexStream

* [maxDatagramSize](https://www.w3.org/TR/webtransport/#dom-webtransportdatagramduplexstream-maxdatagramsize)
* [incomingMaxAge](https://www.w3.org/TR/webtransport/#dom-webtransportdatagramduplexstream-incomingmaxage)
* [outgoingMaxAge](https://www.w3.org/TR/webtransport/#dom-webtransportdatagramduplexstream-outgoingmaxage)
* [incomingHighWaterMark](https://www.w3.org/TR/webtransport/#dom-webtransportdatagramduplexstream-incominghighwatermark)
* [outgoingHighWaterMark](https://www.w3.org/TR/webtransport/#dom-webtransportdatagramduplexstream-outgoinghighwatermark)

## Development notes

### Tests

The unit test suite can be run on both node.js and Chrome to ensure behaviour is consistent between the two environments.

[Mocha](https://www.npmjs.com/package/mocha) is used as a test runner in both environments, in the browser it is run via [playwright-test](https://www.npmjs.com/package/playwright-test).

#### Running all tests:

```console
$ npm test
```

#### Running in node

```console
$ npm run test:node
```

#### Running in Chromium

```console
$ npm run test:chrome
```

#### Forward args

Forward args are supported so you can pass any Mocha or playwright-test options after the `--`:

E.g.:

Run only "unidirectional streams" tests:

```console
$ npm run test:node -- --grep '"unidirectional streams"'
```

Disable headless mode to watch tests run in Chromium:

```console
$ npm run test:chromium -- --debug
```

### Logging

This module uses the [debug](https://www.npmjs.com/package/debug) module for logging.

To enable logging, specify the `DEBUG` environmental variable:

```console
$ DEBUG=webtransport* node my-script.js
// debug output
```

#### Trace logging

To enable detailed output, additionally set the `DEBUG_TRACE` environmental variable:

```console
$ DEBUG=webtransport* DEBUG_TRACE=true node my-script.js
// lots of debug output
```
