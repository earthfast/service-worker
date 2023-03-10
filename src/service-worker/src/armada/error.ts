import {SwCriticalError} from '../error';

export class SwManifestFetchFailureError extends Error {
  readonly isManifestNodeFetchFailure: boolean = true;

  constructor(
      message: string, public status: number = 404, public statusText: string = 'Not Found') {
    super(message);
  }
}

export class SwContentNodesFetchFailureError extends Error {
  readonly isContentNodesFetchFailure: boolean = true;

  constructor(
      message: string, public status: number = 404, public statusText: string = 'Not Found') {
    super(message);
  }
}

export class SwNoArmadaNodes extends SwCriticalError {
  readonly isNoArmadaNodes: boolean = true;
}