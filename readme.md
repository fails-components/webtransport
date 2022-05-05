!["FAILS logo"](failslogo.svg)
# Fancy automated internet lecture system (**FAILS**) - components (Webtransport module)

Tests on master ![master](https://github.com/fails-components/webtransport/actions/workflows/libtest.yml/badge.svg?branch=master), Tests on thordpartylibtracker ![master](https://github.com/fails-components/webtransport/actions/workflows/libtest.yml/badge.svg?branch=thirdpartyibtracker)

(c) 2023- Marten Richter

This package is part of FAILS.
A web based lecture system developed out of university lectures.


While FAILS as a whole is licensed via GNU Affero GPL version 3.0, this package is licensed under a BSD-style license that can be found in the LICENSE file, while code taken from other projects is still under their respective license (see LICENSE file for details).
This package is licensed more permissive, since it can be useful outside of the FAILS environment.

This module is a C++ node binding to libquiche [https://github.com/google/quiche](https://github.com/google/quiche)(note there is a second library with a similar purpose and the same name), which provides besides other network protocols HTTP/3 support.
This packages currently only provides support for HTTP/3 WebTransport with an interface similar to the browser side (but not all features implemented), for server as well as for client, see `test/test.js`, `test/testsuite.js`, `test/echoclient.js`, `test/echoserver.js`  for examples.
Note, the client implementation only supports certificates checking via certificateHashes .
It may be possible in the future to also support normal HTTP/3 without much effort, however there is no intention from the author to implement this, since it will not be needed by FAILS. However PR request are welcome and will be supported by advise from the author.
The package should be considered as a ducttape style solution, until a bullet proof native support of HTTP/3 and WebTransport is provided by node itself.



## Installation and using
You can install the package directly via npm from github via (Note submodule support in recent versions of node is broken [npm 2774](https://github.com/npm/cli/issues/2774), so install will fail, so in this case checkout git repo and submodules directly until first package release):

```bash
npm install --save git+https://github.com/fails-components/webtransport
```
but before you have to add to your `.npmrc` file
```
@fails-components:registry=https://npm.pkg.github.com
```
You need to be authenticated against github.
But this will only work after the initial release (not released yet).
Currently you should just use the github repository for installation:
```bash
npm install --save https://github.com/fails-components/webtransport
```

If you are running the install as root, you need to use `--unsafe-perm` as flag.
Installing the package requires a full building environment including clang-9, perl6, golang,  ninja-build and protobuf-compiler and protobuf headers. See the `Dockerfile` or `Dockerfile.development` for required debian packages. 
This should work for linux and Mac OS X. In principle, compiling under windows should be possible, but not tested yet.  PR for patches and for compiling instructions and necessary changes are welcome for all possible environments. 

In the directory `test` you find a simple echo server code. That answers to a series of WebTransport echos. Furthermore some example browser code and finally a unit test of the library including certificate generation. 

In the directory `certs` some scripts for generating test certificates, originally taken from chromium, libquiche project are provided. However the certicate generation code in the unit test is recommended.

When testing remember you need to start chromium based browser with certain flags to accept your http/3 certificate with errors, e.g.:
```
chrome --ignore-certificate-errors-spki-list=FINGERPRINTOFYOURCERTIFICATE --ignore-certificate-errors --v=2 --enable-logging=stderr --origin-to-force-quic-on=192.168.1.50:8080
```
of course replace IP and fingerprint of your certificate accordingly.
