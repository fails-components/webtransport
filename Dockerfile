# syntax = docker/dockerfile:1.2
FROM node:18-bullseye

ARG ENV

RUN apt-get update -y && apt-get upgrade -y && apt-get install -y clang-9 cmake build-essential perl6 golang  ninja-build && npm_config_yes=true npx playwright install-deps -y


WORKDIR /usr/src/webtransport

COPY package*.json ./

COPY . .


RUN  npm install --production=false --unsafe-perm



#debug
RUN --mount=type=secret,id=GH_TOKEN export GH_TOKEN=`cat /run/secrets/GH_TOKEN`; if [ "$ENV" = "debug" ] ; then npm install ; else  npm ci --only=production; fi



EXPOSE 8080/udp

#CMD [ "node", "src/main.js" ]
