// A new game keeps the library, observations and play preferences. Returning a
// new state lets the UI restore the entire previous game with one undo.
export function resetGameState(state){
  return {...state,board:Array(state.rows).fill(0),currentScore:0,clearedLines:0,
    skills:{dot:0,reroll:0},skillIcons:[],skillIconOrder:[],skillSpawnRemaining:7,
    slots:[null,null,null]};
}
