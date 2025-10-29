// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {InspectorFrontendHostInstance} from './InspectorFrontendHost.js';
import type {DispatchHttpRequestRequest, DispatchHttpRequestResult} from './InspectorFrontendHostAPI.js';

export enum ErrorType {
  HTTP_RESPONSE_UNAVAILABLE = 'HTTP_RESPONSE_UNAVAILABLE',
  NOT_FOUND = 'NOT_FOUND',
}

export class DispatchHttpRequestError extends Error {
  constructor(readonly type: ErrorType, options?: ErrorOptions) {
    super(undefined, options);
  }
}

export async function makeHttpRequest<R>(request: DispatchHttpRequestRequest): Promise<R> {
  const response = await new Promise<DispatchHttpRequestResult>(resolve => {
    InspectorFrontendHostInstance.dispatchHttpRequest(request, resolve);
  });

  debugLog({request, response});
  if (response.statusCode === 404) {
    throw new DispatchHttpRequestError(ErrorType.NOT_FOUND);
  }

  if ('response' in response && response.statusCode === 200) {
    try {
      return JSON.parse(response.response) as R;
    } catch (err) {
      throw new DispatchHttpRequestError(ErrorType.HTTP_RESPONSE_UNAVAILABLE, {cause: err});
    }
  }

  throw new DispatchHttpRequestError(ErrorType.HTTP_RESPONSE_UNAVAILABLE);
}

function isDebugMode(): boolean {
  return Boolean(localStorage.getItem('debugDispatchHttpRequestEnabled'));
}

function debugLog(...log: unknown[]): void {
  if (!isDebugMode()) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('debugLog', ...log);
}

function setDebugDispatchHttpRequestEnabled(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem('debugDispatchHttpRequestEnabled', 'true');
  } else {
    localStorage.removeItem('debugDispatchHttpRequestEnabled');
  }
}

// @ts-expect-error
globalThis.setDebugDispatchHttpRequestEnabled = setDebugDispatchHttpRequestEnabled;
