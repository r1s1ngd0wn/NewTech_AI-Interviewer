export function createTaskGate() {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(task) {
      return task === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}
