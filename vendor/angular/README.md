# Angular Source Code

This directory holds an exact copy of the upstream [Angular Service Worker source code](https://github.com/angular/angular/tree/main/packages/service-worker/worker) at the commit hash that we've most recently rebased on top of. The exact hash is stored in the `COMMIT` file in this directory.

The intention is that this source can be used in two ways:

1. To see exactly how we've modified any base classes that we inherit from:

   ```sh
   diff vendor/angular/worker/src src/service-worker/src/
   ```

1. To easily see how the Angular source has been modified since we last rebased, particularly during a code review.
