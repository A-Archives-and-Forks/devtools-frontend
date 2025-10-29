// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * IMPORTANT! Make sure that any class that is exported here has related unit
 * tests added to foundation_unittests. See front_end/core/i18n/BUILD.gn as an
 * example.
 */
export * as I18n from '../front_end/core/i18n/i18n.js';
export {ConnectionTransport} from '../front_end/core/protocol_client/ConnectionTransport.js';
export {
  PerformanceInsightFormatter
} from '../front_end/models/ai_assistance/data_formatters/PerformanceInsightFormatter.js';
export {
  PerformanceTraceFormatter
} from '../front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.js';
export {AgentFocus} from '../front_end/models/ai_assistance/performance/AIContext.js';
export * as TraceEngine from '../front_end/models/trace/trace.js';
