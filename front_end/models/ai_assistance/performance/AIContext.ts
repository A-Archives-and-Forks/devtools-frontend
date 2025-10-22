// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Trace from '../../../models/trace/trace.js';

import {AICallTree} from './AICallTree.js';

interface AgentFocusData {
  parsedTrace: Trace.TraceModel.ParsedTrace;
  /** Note: at most one of event or callTree is non-null. */
  event: Trace.Types.Events.Event|null;
  /** Note: at most one of event or callTree is non-null. */
  callTree: AICallTree|null;
  insight: Trace.Insights.Types.InsightModel|null;
}

/**
 * Gets the first, most relevant InsightSet to use, following the logic of:
 * 1. If there is only one InsightSet, use that.
 * 2. If there are more, prefer the first we find that has a navigation associated with it.
 * 3. If none with a navigation are found, fallback to the first one.
 * 4. Otherwise, return null.
 */
function getPrimaryInsightSet(insights: Trace.Insights.Types.TraceInsightSets): Trace.Insights.Types.InsightSet|null {
  const insightSets = Array.from(insights.values());
  if (insightSets.length === 0) {
    return null;
  }
  if (insightSets.length === 1) {
    return insightSets[0];
  }

  return insightSets.filter(set => set.navigation).at(0) ?? insightSets.at(0) ?? null;
}

export class AgentFocus {
  static fromParsedTrace(parsedTrace: Trace.TraceModel.ParsedTrace): AgentFocus {
    if (!parsedTrace.insights) {
      throw new Error('missing insights');
    }

    return new AgentFocus({
      parsedTrace,
      event: null,
      callTree: null,
      insight: null,
    });
  }

  static fromInsight(parsedTrace: Trace.TraceModel.ParsedTrace, insight: Trace.Insights.Types.InsightModel):
      AgentFocus {
    if (!parsedTrace.insights) {
      throw new Error('missing insights');
    }

    return new AgentFocus({
      parsedTrace,
      event: null,
      callTree: null,
      insight,
    });
  }

  static fromEvent(parsedTrace: Trace.TraceModel.ParsedTrace, event: Trace.Types.Events.Event): AgentFocus {
    if (!parsedTrace.insights) {
      throw new Error('missing insights');
    }

    const result = AgentFocus.#getCallTreeOrEvent(parsedTrace, event);
    return new AgentFocus({parsedTrace, event: result.event, callTree: result.callTree, insight: null});
  }

  static fromCallTree(callTree: AICallTree): AgentFocus {
    return new AgentFocus({parsedTrace: callTree.parsedTrace, event: null, callTree, insight: null});
  }

  #data: AgentFocusData;
  #primaryInsightSet: Trace.Insights.Types.InsightSet|null;
  readonly eventsSerializer = new Trace.EventsSerializer.EventsSerializer();

  constructor(data: AgentFocusData) {
    if (!data.parsedTrace.insights) {
      throw new Error('missing insights');
    }

    this.#data = data;
    this.#primaryInsightSet = getPrimaryInsightSet(data.parsedTrace.insights);
  }

  get parsedTrace(): Trace.TraceModel.ParsedTrace {
    return this.#data.parsedTrace;
  }

  get primaryInsightSet(): Trace.Insights.Types.InsightSet|null {
    return this.#primaryInsightSet;
  }

  /** Note: at most one of event or callTree is non-null. */
  get event(): Trace.Types.Events.Event|null {
    return this.#data.event;
  }

  /** Note: at most one of event or callTree is non-null. */
  get callTree(): AICallTree|null {
    return this.#data.callTree;
  }

  get insight(): Trace.Insights.Types.InsightModel|null {
    return this.#data.insight;
  }

  withInsight(insight: Trace.Insights.Types.InsightModel|null): AgentFocus {
    const focus = new AgentFocus(this.#data);
    focus.#data.insight = insight;
    return focus;
  }

  withEvent(event: Trace.Types.Events.Event|null): AgentFocus {
    const focus = new AgentFocus(this.#data);
    const result = AgentFocus.#getCallTreeOrEvent(this.#data.parsedTrace, event);
    focus.#data.callTree = result.callTree;
    focus.#data.event = result.event;
    return focus;
  }

  lookupEvent(key: Trace.Types.File.SerializableKey): Trace.Types.Events.Event|null {
    try {
      return this.eventsSerializer.eventForKey(key, this.#data.parsedTrace);
    } catch (err) {
      if (err.toString().includes('Unknown trace event') || err.toString().includes('Unknown profile call')) {
        return null;
      }

      throw err;
    }
  }

  /**
   * If an event is a call tree, this returns that call tree and a null event.
   * If not a call tree, this only returns a non-null event if the event is a network
   * request.
   * This is an arbitrary limitation – it should be removed, but first we need to
   * improve the agent's knowledge of events that are not main-thread or network
   * events.
   */
  static #getCallTreeOrEvent(parsedTrace: Trace.TraceModel.ParsedTrace, event: Trace.Types.Events.Event|null):
      {callTree: AICallTree|null, event: Trace.Types.Events.Event|null} {
    const callTree = event && AICallTree.fromEvent(event, parsedTrace);
    if (callTree) {
      return {callTree, event: null};
    }
    if (event && Trace.Types.Events.isSyntheticNetworkRequest(event)) {
      return {callTree: null, event};
    }
    return {callTree: null, event: null};
  }
}

export function getPerformanceAgentFocusFromModel(model: Trace.TraceModel.Model): AgentFocus|null {
  const parsedTrace = model.parsedTrace();
  if (!parsedTrace) {
    return null;
  }

  return AgentFocus.fromParsedTrace(parsedTrace);
}
