import Immutable from 'immutable'

// debug output
let __DEBUG__
function debug (...args) {
  if (__DEBUG__) {
    if (!console.group) {
      args.unshift('%credux-undo', 'font-style: italic')
    }
    console.log(...args)
  }
}
function debugStart (action, state) {
  if (__DEBUG__) {
    const args = ['action', action.type]
    if (console.group) {
      args.unshift('%credux-undo', 'font-style: italic')
      console.groupCollapsed(...args)
      console.log('received', {state, action})
    } else {
      debug(...args)
    }
  }
}
function debugEnd () {
  if (__DEBUG__) {
    return console.groupEnd && console.groupEnd()
  }
}
// /debug output

// action types
export const ActionTypes = {
  UNDO: '@@redux-undo/UNDO',
  REDO: '@@redux-undo/REDO',
  JUMP_TO_FUTURE: '@@redux-undo/JUMP_TO_FUTURE',
  JUMP_TO_PAST: '@@redux-undo/JUMP_TO_PAST'
}
// /action types

// action creators to change the state
export const ActionCreators = {
  undo () {
    return { type: ActionTypes.UNDO }
  },
  redo () {
    return { type: ActionTypes.REDO }
  },
  jumpToFuture (index) {
    return { type: ActionTypes.JUMP_TO_FUTURE, index }
  },
  jumpToPast (index) {
    return { type: ActionTypes.JUMP_TO_PAST, index }
  }
}
// /action creators

// length: get length of history
function length (history) {
  return history.get('past').size + 1 + history.get('future').size
}
// /length

// insert: insert `state` into history, which means adding the current state
//         into `past`, setting the new `state` as `present` and erasing
//         the `future`.
function insert (history, state, limit) {
  debug('insert', {state, history, free: limit - length(history)})

  const historyOverflow = limit && length(history) >= limit

  if (history.get('present') === undefined || history.get('present').size === 0) {
    // init history
    return history.set('past', Immutable.List())
                  .set('present', state)
                  .set('future', Immutable.List())
  }

  return history.updateIn(['past'], past => past.slice(historyOverflow ? 1 : 0)
                                                .push(history.get('present')))
                .set('present', state)
                .set('future', Immutable.List())
}
// /insert

// undo: go back to the previous point in history
function undo (history) {
  debug('undo', {history})

  if (history.get('past').size <= 0) return history

  return history.updateIn(['past'], past => past.slice(0, history.get('past').size - 1))
                .set('present', history.getIn(['past', history.get('past').size - 1]))
                .updateIn(['future'], future => future.unshift(history.get('present')))
}
// /undo

// redo: go to the next point in history
function redo (history) {
  debug('redo', {history})

  if (history.get('future').size <= 0) return history

  return history.updateIn(['future'], future => future.slice(1, history.get('future').size))
                .set('present', history.getIn(['future', 0]))
                .updateIn(['past'], past => past.push(history.get('present')))
}
// /redo

// jumpToFuture: jump to requested index in future history
function jumpToFuture (history, index) {
  if (index === 0) return redo(history)

  return history.updateIn(['future'], future => future.slice(index + 1))
                .set('present', history.getIn(['future', index]))
                .updateIn(['past'], past => past.push(history.get('present'))
                                                .concat(history.get('future').slice(0, index)))
}
// /jumpToFuture

// jumpToPast: jump to requested index in past history
function jumpToPast (history, index) {
  if (index === history.get('past').size - 1) return undo(history)

  return history.set('future', history.get('past').slice(index + 1)
                                                    .push(history.get('present'))
                                                    .concat(history.get('future')))
                .set('present', history.getIn(['past', index]))
                .updateIn(['past'], past => past.slice(0, index))
}
// /jumpToPast

// wrapState: for backwards compatibility to 0.4
function wrapState (state) {
  return state.set('history', state)
}
// /wrapState

// updateState
function updateState (state, history) {
  return wrapState(state.merge(history))
}
// /updateState

// createHistory
function createHistory (state) {
  return Immutable.fromJS({
    past: [],
    present: undefined,
    future: []
  }).set('present', state)
}
// /createHistory

// parseActions
export function parseActions (rawActions, defaultValue = []) {
  if (Array.isArray(rawActions)) {
    return rawActions
  } else if (typeof rawActions === 'string') {
    return [rawActions]
  }
  return defaultValue
}
// /parseActions

// redux-undo higher order reducer
export default function undoable (reducer, rawConfig = {}) {
  __DEBUG__ = rawConfig.debug

  const config = {
    initialState: rawConfig.initialState,
    initTypes: parseActions(rawConfig.initTypes, ['@@redux/INIT', '@@INIT']),
    limit: rawConfig.limit,
    filter: rawConfig.filter || () => true,
    undoType: rawConfig.undoType || ActionTypes.UNDO,
    redoType: rawConfig.redoType || ActionTypes.REDO,
    jumpToPastType: rawConfig.jumpToPastType || ActionTypes.JUMP_TO_PAST,
    jumpToFutureType: rawConfig.jumpToFutureType || ActionTypes.JUMP_TO_FUTURE
  }
  config.history = rawConfig.initialHistory || createHistory(config.initialState)

  if (config.initTypes.length === 0) {
    console.warn('redux-undo: supply at least one action type in initTypes to ensure initial state')
  }

  return (state, action) => {
    debugStart(action, state)
    let res
    switch (action.type) {
      case config.undoType:
        res = undo(state)
        debug('after undo', res)
        debugEnd()
        return res ? updateState(state, res) : state

      case config.redoType:
        res = redo(state)
        debug('after redo', res)
        debugEnd()
        return res ? updateState(state, res) : state

      case config.jumpToPastType:
        res = jumpToPast(state, action.index)
        debug('after jumpToPast', res)
        debugEnd()
        return res ? updateState(state, res) : state

      case config.jumpToFutureType:
        res = jumpToFuture(state, action.index)
        debug('after jumpToFuture', res)
        debugEnd()
        return res ? updateState(state, res) : state

      default:
        res = reducer(state && state.get('present'), action)

        if (config.initTypes.some((actionType) => actionType === action.type)) {
          debug('reset history due to init action')
          debugEnd()
          return wrapState((state || Immutable.Map()).merge(createHistory(res)))
        }

        if (config.filter && typeof config.filter === 'function') {
          if (!config.filter(action, res, state && state.get('present'))) {
            debug('filter prevented action, not storing it')
            debugEnd()
            return wrapState((state || Immutable.Map()).merge(Immutable.fromJS({ present: undefined }).set('present', res)))
          }
        }

        const history = (state && state.get('present') !== undefined) ? state : config.history
        const updatedHistory = insert(history, res, config.limit)
        debug('after insert', {history: updatedHistory, free: config.limit - length(updatedHistory)})
        debugEnd()

        return wrapState((state || Immutable.Map()).merge(updatedHistory))
    }
  }
}
// /redux-undo

// distinctState helper
export function distinctState () {
  return (action, currentState, previousState) => currentState !== previousState
}
// /distinctState

// includeAction helper
export function includeAction (rawActions) {
  const actions = parseActions(rawActions)
  return (action) => actions.indexOf(action.type) >= 0
}
// /includeAction

// deprecated ifAction helper
export function ifAction (rawActions) {
  console.error('Deprecation Warning: Please change `ifAction` to `includeAction`')
  return includeAction(rawActions)
}
// /ifAction

// excludeAction helper
export function excludeAction (rawActions = []) {
  const actions = parseActions(rawActions)
  return (action) => actions.indexOf(action.type) < 0
}
// /excludeAction
