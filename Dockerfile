##
## Build
##
FROM node:18 AS build

WORKDIR /armada-sw

COPY package.json .
COPY package-lock.json .
RUN npm install

COPY . .
RUN npm run build

##
## Package
##
FROM scratch

COPY --from=build /armada-sw/dist /armada-sw/dist
