export class ActivityTracker {
  private readonly activeOperations = new Set<Promise<void>>();

  track<T>(operation: PromiseLike<T>): Promise<T> {
    const result = Promise.resolve(operation);
    let completion: Promise<void>;

    completion = result.then(
      () => {
        this.activeOperations.delete(completion);
      },
      () => {
        this.activeOperations.delete(completion);
      }
    );
    this.activeOperations.add(completion);

    return result;
  }

  async waitForIdle(): Promise<void> {
    while (this.activeOperations.size > 0) {
      await Promise.all(this.activeOperations);
    }
  }
}
