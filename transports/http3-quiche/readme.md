!["FAILS logo"](failslogo.svg)
# Fancy automated internet lecture system (**FAILS**) - components (Webtransport module)

Linux tests on master ![master](https://github.com/fails-components/webtransport/actions/workflows/libtest-linux.yml/badge.svg?branch=master)

Windows tests on master ![master](https://github.com/fails-components/webtransport/actions/workflows/libtest-windows.yml/badge.svg?branch=master)

Macos tests on master ![master](https://github.com/fails-components/webtransport/actions/workflows/libtest-macos.yml/badge.svg?branch=master)

(c) 2022- Marten Richter

The package provides the http/3 libquiche transports or the main package.

This package is part of FAILS.
A web-based lecture system developed out of university lectures.

While FAILS as a whole is licensed via GNU Affero GPL version 3.0, this package is licensed under a BSD-style license that can be found in the LICENSE file, while code taken from other projects is still under their respective license (see LICENSE file for details).
This package is licensed more permissive since it can be useful outside of the FAILS environment.

This package only provides the C++ binding to libquiche for http/3 support, please see the `@fails-components/webtransport` package for complete information in [readme.md](../../main/readme.md). Note you can not and should not use this package without the main package. The version of this package must match the version number of the main package. This package ABI or API is not stable and should only be used by the node.js package and not in another package.
