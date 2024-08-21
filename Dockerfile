##
## Build
##
FROM node:18 AS build

WORKDIR /earthfast-sw

COPY package.json .
COPY package-lock.json .
RUN npm install

COPY . .
RUN npm run build

##
## Package
##
FROM scratch

COPY --from=build /earthfast-sw/dist /earthfast-sw/dist
