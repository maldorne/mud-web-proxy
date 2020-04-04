# mud-web-proxy

[node.js](https://nodejs.org/en/) microserver which provides a secure websocket (`wss://` protocol) to telnet (`telnet://`) proxy for [MUD](https://en.wikipedia.org/wiki/MUD) / MUSH / MOO game servers, supporting all major data interchange and interactive text protocols. You can use the `[mud-web-client]` project to achieve that.

This project is a fork of [MUDPortal-Web-App](https://github.com/plamzi/MUDPortal-Web-App), made by [@plamzi](https://github.com/plamzi), creator of [mudportal.com](http://www.mudportal.com/). The original project had the code of both the client and proxy-server apps, and was outdated and did not support secure connections (`wss://` instead of `ws://`), so I decided to fork it, separate in different projects and update them. But kudos to [@plamzi](https://github.com/plamzi), who is the original author.

## Features

* Window-based web UI with draggable and resizable windows, window toolbar.

* MCCP compression support (zlib)

* MXP protocol support built into the client

* MSDP protocol support

* GMCP / ATCP protocol support (JSON) with sample uses in multiple existing plugins

* 256-color support, including background colors

* Unicode font support and UTF-8 negotiation

* Vector-based world mapper with flexible edit mode to allow for mapping any MUD world via exploration

* Triggers / macros / command memory with typeahead


## Installation

``` bash
git clone https://github.com/houseofmaldorne/mud-web-client
npm install
```

* Copy all files to a web-accessible folder on your web server.

* Point a browser at the root of the folder to load the included `index.html` file.

## Configuration

To Do

