# EarthFast Service Worker

### Overview
This doc provides an overview of the EarthFast Service Worker, its purpose, and how it extends the Angular service worker functionality.

From [Angular docs](https://angular.io/guide/service-worker-intro)
>At its simplest, a service worker is a script that runs in the web browser and manages caching for an application.
>
>Service workers function as a network proxy. They intercept all outgoing HTTP requests made by the application and can choose how to respond to them. For example, they can query a local cache and deliver a cached response if one is available. Proxying isn't limited to requests made through programmatic APIs, such as fetch; it also includes resources referenced in HTML and even the initial request to index.html. Service worker-based caching is thus completely programmable and doesn't rely on server-specified caching headers.
>
>Unlike the other scripts that make up an application, such as the Angular application bundle, the service worker is preserved after the user closes the tab. The next time that browser loads the application, the service worker loads first, and can intercept every request for resources to load the application. If the service worker is designed to do so, it can completely satisfy the loading of the application, without the need for the network.
>
>To achieve this, the Angular service worker follows these guidelines:
>
>Caching an application is like installing a native application. The application is cached as one unit, and all files update together.
>
>A running application continues to run with the same version of all files. It does not suddenly start receiving cached files from a newer version, which are likely incompatible.
>
>When users refresh the application, they see the latest fully cached version. New tabs load the latest cached code.
>
>Updates happen in the background, relatively quickly after changes are published. The previous version of the application is served until an update is installed and ready.
>
>The service worker conserves bandwidth when possible. Resources are only downloaded if they've changed.
>
>To support these behaviors, the Angular service worker loads a manifest file from the server. The file, called ngsw.json (not to be confused with the web app manifest), describes the resources to cache and includes hashes of every file's contents. When an update to the application is deployed, the contents of the manifest change, informing the service worker that a new version of the application should be downloaded and cached. This manifest is generated from a CLI-generated configuration file called ngsw-config.json.

EarthFast uses the network proxy + caching properties of service workers not for offline app caching and availability, but rather to proxy all requests through a service worker so content can be validated before being served to the user as well as intelligent handling of cache expiry etc.

### Repo Layout & Structure
The main entry point is [src/service-worker/main.ts](src/service-worker/main.ts), which is a modified version from the [angular service worker](https://github.com/angular/angular/blob/main/packages/service-worker/worker/main.ts). The modifications are basically to use the EarthFast driver and overrides as opposed to the base Angular driver. This gets sent into rollup to create a built version which outputs to the dist/ directory.


```
├── src
│   ├── landing-page - splash screen displayed to users when making request to domain node, initializing service worker and fetching content from content nodes
│   │   └── earthfast
│   │       ├── fonts
│   │       ├── images
│   │       └── styles
│   └── service-worker
│       ├── src - contains copy of the angular service worker WITH MODIFICATIONS. modifications are minor but see [here](vendor/angular/README.md) to check the diff
│       │   └── armada - contains class overrides for the base angular service worker to add custom EarthFast functionality
│       ├── test - follows a similar pattern as src/ with vendored angular files and EarthFast overrides
│       └── testing - follows a similar pattern as src/ with vendored angular files and EarthFast overrides
└── vendor
    └── angular
        └── worker - vendored angular code
        ├── COMMIT - stores the commit that service worker was vendored from
        ├── README.md - how to check the diff between upstream angular service worker and vendored service-worker/src/ files

### How to Release the Service Worker

To release a new version of the EarthFast Service Worker, follow these steps:

1. Ensure all changes are committed and pushed to the main branch.
2. Go to the "Releases" section on the GitHub repository page.
3. Click on "Draft a new release".
4. In the "Choose a tag" dropdown, create a new tag that increments the version number appropriately. For example, if the current version is v0.11.0, create v0.12.0 for a minor version bump, or v0.11.1 for a patch.
5. Click "Generate release notes" to automatically populate the release description with changes since the last release.
6. Review the generated notes and make any necessary edits or additions.
7. Click "Publish release" to create the new release and tag.
8. Navigate to the inexorable-node project repository.
9. Update the service-worker version in `src/Dockerfile.domain` to match the new release version.
10. Commit and push this change to the inexorable-node repository.


### Dev Guide
To try to work on EarthFast Service Worker, the easiest way to test functionality is with tests. There's EarthFast specific unit tests as well as cypress E2E tests. It is possible to run the service worker locally as part of a full EarthFast stack, more info in the Dev Guides.

All the functionality for building, testing is in package.json. Run `npm install` to install dependencies and `npm run` to list possible commands.

### Useful Links
- https://blog.angular-university.io/angular-service-worker/
- https://angular.io/guide/service-worker-intro

### Technical Documentation

<details>
<summary>Click to expand technical details</summary>

#### Angular Files Overview

1. `adapter.ts` - This file defines an `Adapter` interface that abstracts interactions with the global scope and the clients. It allows the service worker to be platform-agnostic by providing a way to perform operations like fetching resources, scheduling tasks, and accessing caches without directly using browser APIs.

2. `api.ts` - Contains type definitions for the low-level API used by the service worker to handle caching, fetch requests, and other operations. It defines interfaces and types that are used across the service worker implementation.

3. `app-version.ts` - Manages different versions of the application by keeping track of the assets and data groups associated with a particular version. It helps in activating new versions and cleaning up old ones.

4. `assets.ts` - Implements asset groups that handle the caching of application assets. It includes logic for downloading assets, serving them from the cache, and updating them when a new version of the application is available.

5. `data.ts` - Handles dynamic data caching strategies. It defines classes and interfaces for managing data groups, which are used to cache and update dynamic content based on configured caching patterns.

6. `database.ts` - Provides a simple database abstraction over IndexedDB to store and manage metadata about the service worker's state, such as active app versions and their associated files.

7. `db-cache.ts` - Implements a caching layer on top of the database abstraction. It is used to store and retrieve request/response pairs in the IndexedDB database.

8. `debug.ts` - Contains utility functions for debugging the service worker. It may include methods for logging and tracking the internal state of the service worker for development purposes.

9. `driver.ts` - The main entry point for the service worker logic. It orchestrates the service worker's behavior, including installation, activation, and response to fetch events. It coordinates with other modules to implement caching strategies and handle app updates.

10. `error.ts` - Defines custom error types used by the service worker. These errors are thrown when specific issues are encountered, such as failed asset or data group updates.

11. `idle.ts` - Manages idle tasks within the service worker. It provides a mechanism to schedule and execute tasks when the service worker is not busy handling other events.

12. `manifest.ts` - Contains logic for parsing and validating the manifest file that describes the assets and data groups to be cached by the service worker.

13. `msg.ts` - Defines messaging protocols between the service worker and its clients. It includes the types and interfaces for sending messages to control the service worker or request information from it.

14. `named-cache-storage.ts` - Provides an abstraction for working with named caches in the Cache Storage API. It simplifies the process of creating, retrieving, and managing caches with specific names.

15. `service-worker.d.ts` - A TypeScript declaration file that provides type definitions for the service worker's global scope. It helps ensure type safety and autocompletion when working with service worker-related code.

16. `sha1.ts` - Implements a SHA-1 hashing function. It is used to generate hashes for assets and other content to ensure their integrity and to manage cache keys.

#### EarthFast Files & Overrides

##### api.ts
The `ArmadaAPIClientImpl` class implements the `ArmadaAPIClient` interface, providing methods to fetch content and content node information from a network. It constructs URLs for API requests and appends query parameters, including a cache-busting parameter. It also handles errors and throws if the response from the network is not successful.

##### app-version.ts
The `ArmadaAppVersion` class extends the base `AppVersion` class, modifying the behavior of the service worker to intercept and fetch requests differently. It introduces a custom `ArmadaLazyAssetGroup` for managing asset groups, which replaces the default asset group implementations. The class also includes a special case for handling navigation requests to directories by serving the corresponding `index.html` if it exists. Underlying service worker functionality like data groups are not supported in this override.

##### assets.ts
The `ArmadaLazyAssetGroup` class extends the base `LazyAssetGroup` class, changing the way assets are fetched and validated. It introduces a custom fetch mechanism that attempts to retrieve content from a list of nodes, retrying up to a maximum number of attempts. The class ensures the integrity of fetched assets by comparing their hashes with known good values and uses a custom `ThrowingFetcher` to ensure all fetches go through the checksum test. Additionally, it handles cache-busted network fetches differently, aiming to use the HTTP cache when possible and creating a new `Response` instance with an empty `url` property for relative URL correctness in stylesheets.

##### consensus.ts
The `majorityResult` function is a utility that resolves when a majority of provided promises agree on a result or rejects if a majority fail or no majority can be reached. It wraps each promise with an identifier and tracks the count of unique results and errors. The function uses a race condition to wait for the fastest unsettled promise and determines if a majority is still possible. If a majority is reached for a particular result, the function resolves with that result; otherwise, it throws an error indicating no majority was achieved. This utility does not modify the behavior of the service worker directly but could be used to reach a consensus on certain decisions within the service worker's logic.

##### driver.ts
The `ArmadaDriver` class extends the base `Driver` class, modifying the initialization and fetch handling processes. It uses custom `ArmadaAppVersion` instances and has a different approach to checking for updates, requiring a majority consensus from content nodes. It also overrides the `handleFetch` method to ensure the service worker is initialized before handling fetch events and to handle navigation requests differently.

##### error.ts
Custom error classes are defined to handle specific error scenarios related to manifest and content node fetch failures. These include `SwManifestFetchFailureError` and `SwContentNodesFetchFailureError`, which carry additional information like HTTP status and status text.

##### msg.ts
A set of functions are provided to create message objects related to various error scenarios, such as manifest fetch errors, content node fetch failures, and content checksum mismatches. These messages are used for communication between different parts of the service worker.

##### registry.ts
The `NodeRegistry` interface and its implementations (`StaticNodeRegistry` and `DynamicNodeRegistry`) manage a list of content nodes. The `DynamicNodeRegistry` can refresh the list of nodes at a set interval, and both registries can provide a randomized list of nodes. The `HashableNodesResponse` class wraps a `NodesResponse` to make it compatible with the `majorityResult` function.

</details>
