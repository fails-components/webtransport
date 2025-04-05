// Ported from libquiche, PriorityScheduler and  BTreeScheduler so their license applies to the original in C++ and this javascript translation
// Copyright (c) 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// A record for a registered stream.

/**
 * @typedef {object} Priority
 * @property {SendGroupId} sendGroupId
 * @property {bigint} sendOrder
 */

/**
 * @typedef {bigint} SendGroupId
 */

/**
 * @typedef {bigint} SendOrder
 */

/**
 *
 * @param {StreamId} sendGroupId
 * @returns {string}
 */
function sendGroupIdToKey(sendGroupId) {
  return sendGroupId.toString()
}
/**
 * @typedef {bigint} StreamId
 */

/**
 *
 * @param {StreamId} streamId
 * @returns {string}
 */
function streamIdToKey(streamId) {
  return streamId.toString()
}

class StreamEntry {
  /**
   * @param {SendOrder} priority
   */
  constructor(priority) {
    this.priority = priority
    /**
     * @type {number|undefined}
     */
    this.currentSequenceNumber = undefined
  }

  scheduled() {
    return typeof this.currentSequenceNumber !== 'undefined'
  }
}

/**
 * @typedef {object} FullStreamEntry
 * @property {SendGroupId} iD
 * @property {StreamEntry} streamEntry
 */

/**
 * @typedef {object} ScheduleKey
 * @property {SendOrder} priority
 * @property {number} sequenceNumber
 */

/*struct StreamEntry {
    // The current priority of the stream.
    ABSL_ATTRIBUTE_NO_UNIQUE_ADDRESS Priority priority;
    // If present, the sequence number with which the stream is currently
    // scheduled.  If absent, indicates that the stream is not scheduled.
    std::optional<int> currentSequenceNumber = std::nullopt;

    bool scheduled() const { return currentSequenceNumber.has_value(); }
  };
  // The full entry for the stream (includes the ID that's used as a hashmap
  // key).
  using FullStreamEntry = std::pair<const Id, StreamEntry>;

  // A key that is used to order entities within the schedule.
  struct ScheduleKey {
    // The main order key: the priority of the stream.
    ABSL_ATTRIBUTE_NO_UNIQUE_ADDRESS Priority priority;
    // The secondary order key: the sequence number.
    int sequenceNumber;

    // Orders schedule keys in order of decreasing priority.
    bool operator<(const ScheduleKey& other) const {
      return std::make_tuple(priority, sequenceNumber) >
             std::make_tuple(other.priority, other.sequenceNumber);
    }

    // In order to find all entities with priority `p`, one can iterate between
    // `lower_bound(MinForPriority(p))` and `upper_bound(MaxForPriority(p))`.
    static ScheduleKey MinForPriority(Priority priority) {
      return ScheduleKey{priority, std::numeric_limits<int>::max()};
    }
    static ScheduleKey MaxForPriority(Priority priority) {
      return ScheduleKey{priority, std::numeric_limits<int>::min()};
    }
  };
*/
// BTreeScheduler is a data structure that allows streams (and potentially other
// entities) to be scheduled according to the arbitrary priorities.  The API for
// using the scheduler can be used as follows:
//  - A stream has to be registered with a priority before being scheduled.
//  - A stream can be unregistered, or can be re-prioritized.
//  - A stream can be scheduled; that adds it into the queue.
//  - PopFront() will return the stream with highest priority.
//  - ShouldYield() will return if there is a stream with higher priority than
//    the specified one.
//
// The prioritization works as following:
//  - If two streams have different priorities, the higher priority stream goes
//    first.
//  - If two streams have the same priority, the one that got scheduled earlier
//    goes first. Internally, this is implemented by assigning a monotonically
//    decreasing sequence number to every newly scheduled stream.
//
// The Id type has to define operator==, be hashable via absl::Hash, and
// printable via operator<<; the Priority type has to define operator<.

/**
 *
 * @param {ScheduleKey} a
 * @param {ScheduleKey} b
 * @returns
 */
function compareStreamEntries(a, b) {
  // for sort
  if (a.priority > b.priority) {
    return -1
  } else if (a.priority === b.priority) {
    if (a.sequenceNumber > b.sequenceNumber) {
      return -1
    } else if (a.sequenceNumber === b.sequenceNumber) {
      return 0
    } else {
      return 1
    }
  } else {
    return 1
  }
}
/**
 *
 * @param {{scheduleKey: ScheduleKey}} a
 * @param {{scheduleKey: ScheduleKey}} b
 * @returns
 */

function compareFullStreamEntries(a, b) {
  return compareStreamEntries(a.scheduleKey, b.scheduleKey)
}

class BTreeScheduler {
  constructor() {
    // The map of currently registered streams.
    /**
     * @type {Object<string, StreamEntry>}
     */
    this.streams_ = {} // Id, StreamEntry
    // The stream schedule, ordered starting from the highest priority stream.
    /**
     * @type {{scheduleKey: ScheduleKey, fullStreamEntry: FullStreamEntry}[]}
     */
    this.schedule_ = [] // ScheduleKey, FullStreamEntry

    // The counter that is used to ensure that streams with the same priority are
    // handled in the FIFO order.  Decreases with every write.
    this.currentWriteSequenceNumber_ = 0
  }

  // Returns true if there are any streams registered.
  HasRegistered() {
    return Object.keys(this.streams_).length !== 0
  }
  // Returns true if there are any streams scheduled.
  HasScheduled() {
    return Object.keys(this.schedule_).length !== 0
  }
  // Returns the number of currently scheduled streams.
  NumScheduled() {
    return Object.keys(this.schedule_).length
  }
  // Returns the total number of currently registered streams.
  NumRegistered() {
    return Object.keys(this.streams_).length
  }

  // Counts the number of scheduled entries in the range [min, max].  If either
  // min or max is omitted, negative or positive infinity is assumed.

  /**
   * @param {number} min
   * @param {number} max
   */
  NumScheduledInPriorityRange(min, max) {
    /*if (typeof min !== 'undefined' && typeof max !== 'undefined') {
    //QUICHE_DCHECK(*min <= *max);
  }*/
    // This is reversed, since the schedule is ordered in the descending priority
    // order.
    const begin =
      typeof max !== 'undefined'
        ? this.schedule_.findIndex((el) => el.scheduleKey.priority <= max)
        : 0
    const end =
      typeof min !== 'undefined'
        ? this.schedule_.findIndex((el) => el.scheduleKey.priority >= min)
        : this.schedule_.length
    return end - begin
  }

  // Returns true if there is a stream that would go before `id` in the
  // schedule.
  /**
   * @param {StreamId} streamId
   */
  ShouldYield(streamId) {
    const stream = this.streams_[streamIdToKey(streamId)]
    if (!stream) {
      throw new Error('ID not registered')
    }

    if (this.schedule_.length === 0) {
      return false
    }
    const next = this.schedule_[0]
    if (BTreeScheduler.StreamId(next) == streamId) {
      return false
    }
    return next.scheduleKey.priority >= stream.priority
  }

  // Returns the priority for `id`, or nullopt if stream is not registered.
  /**
   * @param {StreamId} id
   */
  GetPriorityFor(id) {
    const it = this.streams_[streamIdToKey(id)]
    if (!it) {
      return undefined
    }
    return it.priority
  }

  // Pops the highest priority stream.  Will fail if the schedule is empty.
  PopFront() {
    if (this.schedule_.length === 0) {
      return undefined
    }
    const scheduleIt = this.schedule_[0]
    //QUICHE_DCHECK(scheduleIt->second->second.scheduled());
    scheduleIt.fullStreamEntry.streamEntry.currentSequenceNumber = undefined

    const result = BTreeScheduler.StreamId(scheduleIt)
    this.schedule_.shift()
    return result
  }

  // Registers the specified stream with the supplied priority.  The stream must
  // not be already registered.
  /**
   * @param {StreamId} streamId
   * @param {Priority} priority
   */
  Register(streamId, priority) {
    if (this.streams_[streamIdToKey(streamId)]) {
      throw new Error('ID already registered')
    }
    this.streams_[streamIdToKey(streamId)] = new StreamEntry(priority.sendOrder)
  }
  // Unregisters a previously registered stream.
  /**
   * @param {StreamId} streamId
   */
  Unregister(streamId) {
    const it = /** @type {StreamEntry|undefined} */ (
      this.streams_[streamIdToKey(streamId)]
    )
    if (!it) {
      throw new Error('Stream not registered')
    }

    if (it.scheduled()) {
      this.DescheduleStream(it)
    }

    delete this.streams_[streamIdToKey(streamId)]
  }
  // Alters the priority of an already registered stream.
  /**
   * @param {StreamId} streamId
   * @param {SendOrder} newPriority
   */
  UpdatePriority(streamId, newPriority) {
    const stream = this.streams_[streamIdToKey(streamId)]
    if (!stream) {
      return new Error('ID not registered')
    }

    let sequenceNumber
    if (stream.scheduled()) {
      const oldEntry = this.DescheduleStream(stream)
      sequenceNumber = oldEntry.scheduleKey.sequenceNumber
      //QUICHE_DCHECK_EQ(oldEntry->second, &*it);
    }

    stream.priority = newPriority
    if (sequenceNumber) {
      this.schedule_.push({
        scheduleKey: { priority: stream.priority, sequenceNumber },
        fullStreamEntry: {
          iD: streamId,
          streamEntry: stream
        }
      })
      this.schedule_.sort(compareFullStreamEntries)
    }
  }

  // Adds the `stream` into the schedule if it's not already there.

  /**
   * @param {StreamId} streamId
   */
  Schedule(streamId) {
    const streamIt = this.streams_[streamIdToKey(streamId)]
    if (!streamIt) {
      return new Error('ID not registered')
    }
    if (streamIt.scheduled()) {
      return
    }
    const newElement = {
      scheduleKey: {
        priority: streamIt.priority,
        sequenceNumber: --this.currentWriteSequenceNumber_
      },
      fullStreamEntry: {
        iD: streamId,
        streamEntry: streamIt
      }
    }
    this.schedule_.push(newElement)
    this.schedule_.sort(compareFullStreamEntries)

    streamIt.currentSequenceNumber = newElement.scheduleKey.sequenceNumber
  }
  // Deschedules a stream that is known to be currently scheduled.

  /**
   * @param {StreamId} streamId
   */
  Deschedule(streamId) {
    const stream = this.streams_[streamIdToKey(streamId)]
    if (!stream) {
      throw new Error('Stream not registered')
    }

    if (!stream.scheduled()) {
      throw new Error('Stream not scheduled')
    }
    this.DescheduleStream(stream)
    stream.currentSequenceNumber = undefined
  }
  // Returns true if `stream` is in the schedule.

  /**
   * @param {StreamId} streamId
   */
  IsScheduled(streamId) {
    const streamIt = this.streams_[streamIdToKey(streamId)]
    if (!streamIt) {
      return false
    }
    return streamIt.scheduled()
  }

  /*
  using FullScheduleEntry = std::pair<const ScheduleKey, FullStreamEntry*>;
  using ScheduleIterator =
      typename absl::btree_map<ScheduleKey, FullStreamEntry*>::const_iterator;*/

  // Convenience method to get the stream ID for a schedule entry.

  /**
   * @param {{scheduleKey: ScheduleKey, fullStreamEntry: FullStreamEntry}} entry
   */
  static StreamId(entry) {
    return entry.fullStreamEntry.iD
  }

  // Removes a stream from the schedule, and returns the old entry if it were
  // present.
  /**
   * @param {StreamEntry} entry
   */
  DescheduleStream(entry) {
    //QUICHE_DCHECK(entry.scheduled());
    const it = this.schedule_.findIndex(
      (el) =>
        entry.priority === el.scheduleKey.priority &&
        entry.currentSequenceNumber ===
          el.fullStreamEntry.streamEntry.currentSequenceNumber
    )

    if (it === -1) {
      throw new Error(
        'Calling DescheduleStream() on an entry that is not in the schedule at ' +
          'the expected key.'
      )
    }
    const result = this.schedule_[it]
    this.schedule_.splice(it, 1)
    return result
  }
}

export class PriorityScheduler {
  constructor() {
    //  using PerGroupScheduler = quiche:: BTreeScheduler<StreamId, SendOrder>;
    // using GroupSchedulerPair = std:: pair<const SendGroupId, PerGroupScheduler>;

    // Round-robin schedule for the groups.
    this.activeGroups_ = new BTreeScheduler() // SendGroupId, SinglePriority
    // Map group ID to the scheduler for the group in question.
    /**
     * @type {Object<string, BTreeScheduler>}
     */
    this.perGroupSchedulers_ = {} // absl:: node_hash_map < SendGroupId, PerGroupScheduler >
    // Map stream ID to a pointer to the entry in `perGroupSchedulers_`.
    /**
     * @type {Object<string, {sendGroupId: SendGroupId, perGroupScheduler: BTreeScheduler }>}
     */
    this.streamToGroupMap_ = {} // absl:: flat_hash_map < StreamId, GroupSchedulerPair *>
  }

  // Returns true if there are any streams registered.
  HasRegistered() {
    return this.activeGroups_.HasRegistered()
  }
  // Returns true if there are any streams scheduled.
  HasScheduled() {
    return this.activeGroups_.HasScheduled()
  }

  // Returns the number of currently scheduled streams.
  NumScheduled() {
    let total = 0
    for (const [, groupScheduler] of Object.entries(this.perGroupSchedulers_)) {
      total += groupScheduler.NumScheduled()
    }
    return total
  }

  // Registers the specified stream with the supplied priority.  The stream must
  // not be already registered.
  /**
   * @param {StreamId} streamId
   * @param {Priority} priority
   */
  Register(streamId, priority) {
    if (this.streamToGroupMap_[streamIdToKey(streamId)]) {
      throw new Error('Provided stream ID already registered')
    }
    if (!this.perGroupSchedulers_[sendGroupIdToKey(priority.sendGroupId)]) {
      this.perGroupSchedulers_[sendGroupIdToKey(priority.sendGroupId)] =
        new BTreeScheduler()
      this.activeGroups_.Register(priority.sendGroupId, priority) // TODO, may be we have to add a scheduler
    }
    const scheduler =
      this.perGroupSchedulers_[sendGroupIdToKey(priority.sendGroupId)]
    this.streamToGroupMap_[streamIdToKey(streamId)] = {
      sendGroupId: priority.sendGroupId,
      perGroupScheduler: scheduler
    }
    scheduler.Register(streamId, priority)
  }
  // Unregisters a previously registered stream.
  /**
   * @param {StreamId} streamId
   */
  Unregister(streamId) {
    const stream = this.streamToGroupMap_[streamIdToKey(streamId)]
    if (!stream) {
      throw new Error('Stream ID not registered')
    }
    const groupId = stream.sendGroupId
    const groupScheduler = stream.perGroupScheduler
    delete this.streamToGroupMap_[streamIdToKey(streamId)]
    groupScheduler.Unregister(streamId)

    // Clean up the group if there are no more streams associated with it.
    if (!groupScheduler.HasRegistered()) {
      delete this.perGroupSchedulers_[sendGroupIdToKey(groupId)]
      this.activeGroups_.Unregister(groupId)
    }
  }
  // Alters the priority of an already registered stream.
  /**
   * @param {StreamId} streamId
   * @param {bigint} newSendOrder
   */
  UpdateSendOrder(streamId, newSendOrder) {
    const scheduler = this.SchedulerForStream(streamId)
    if (!scheduler) {
      throw new Error('Stream ID not registered')
    }
    return scheduler.UpdatePriority(streamId, newSendOrder)
  }

  /**
   * @param {StreamId} streamId
   * @param {SendGroupId} newSendGroup
   */
  UpdateSendGroup(streamId, newSendGroup) {
    const scheduler = this.SchedulerForStream(streamId)
    if (!scheduler) {
      throw new Error('Stream ID not registered')
    }
    const isScheduled = scheduler.IsScheduled(streamId)
    const sendOrder = scheduler.GetPriorityFor(streamId)
    if (!sendOrder) {
      throw new Error(
        'Stream registered at the top level scheduler, but not at the per-group one'
      )
    }
    this.Unregister(streamId)

    this.Register(streamId, { sendGroupId: newSendGroup, sendOrder })
    if (isScheduled) {
      this.Schedule(streamId)
    }
  }

  // Returns true if there is a stream that would go before `id` in the
  // schedule.
  /**
   * @param {StreamId} streamId
   */
  ShouldYield(streamId) {
    const stream = this.streamToGroupMap_[streamIdToKey(streamId)]
    if (!stream) {
      throw new Error('Stream ID not registered')
    }
    const { sendGroupId, perGroupScheduler } = stream

    const perGroupResult = this.activeGroups_.ShouldYield(sendGroupId)
    if (perGroupResult) {
      return true
    }

    return perGroupScheduler.ShouldYield(streamId)
  }

  // Returns the priority for `id`, or nullopt if stream is not registered.
  /**
   * @param {StreamId} streamId
   */
  GetPriorityFor(streamId) {
    const stream = this.streamToGroupMap_[streamIdToKey(streamId)]
    if (!stream) {
      return null
    }
    const { sendGroupId, perGroupScheduler } = stream
    const sendOrder = perGroupScheduler.GetPriorityFor(streamId)
    if (!sendOrder) {
      return null
    }
    return { sendGroupId, sendOrder }
  }

  // Pops the highest priority stream.  Will fail if the schedule is empty.
  PopFront() {
    const groupId = this.activeGroups_.PopFront()
    if (typeof groupId === 'undefined') {
      return undefined
    }

    const scheduler = this.perGroupSchedulers_[sendGroupIdToKey(groupId)]
    if (!scheduler) {
      throw new Error('Scheduled a group with no per-group scheduler attached')
    }
    const result = scheduler.PopFront()
    if (typeof result === 'undefined') {
      return undefined
    }

    // Reschedule the group if it has more active streams in it.
    if (scheduler.HasScheduled()) {
      this.activeGroups_.Schedule(groupId)
    }
    return result
  }

  // Adds `stream` to the schedule if it's not already there.
  /**
   * @param {StreamId} streamId
   */
  Schedule(streamId) {
    const it = this.streamToGroupMap_[streamIdToKey(streamId)]
    if (!it) {
      return new Error('Stream ID not registered')
    }
    const { sendGroupId, perGroupScheduler } = it
    this.activeGroups_.Schedule(sendGroupId)
    return perGroupScheduler.Schedule(streamId)
  }
  // Returns true if `stream` is in the schedule.
  /**
   * @param {StreamId} streamId
   */
  IsScheduled(streamId) {
    const scheduler = this.SchedulerForStream(streamId)
    if (!scheduler) {
      return false
    }
    return scheduler.IsScheduled(streamId)
  }

  /*
// All groups currently have the equal priority; this type represents the said
// single priority.
class SinglePriority {
    public:
        bool operator== (const SinglePriority&) const { return true; }
       bool operator != (const SinglePriority&) const { return false; }
   
       bool operator < (const SinglePriority&) const { return false; }
       bool operator > (const SinglePriority&) const { return false; }
       bool operator <= (const SinglePriority&) const { return true; }
       bool operator >= (const SinglePriority&) const { return true; }
     };

     */

  /**
   * @param {StreamId} streamId
   */
  SchedulerForStream(streamId) {
    const it = this.streamToGroupMap_[streamIdToKey(streamId)]
    if (!it) {
      return undefined
    }
    return it.perGroupScheduler
  }
}
