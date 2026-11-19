export class SavedView {
  id: string;
  userId: string;
  name: string;
  signalType: string;
  query: string;
  shared: boolean;
  dateCreated: string;
  dateUpdated: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(data?: any) {
    if (data) {
      Object.assign(this, data);
      this.shared = Boolean(data.shared);
    }
  }
}
