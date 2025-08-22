export class Settings {
  category: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(data?: any) {
    if (!data) {
      return;
    }
    if (data.category) this.category = data.category;
    if (data.content && typeof data.content === "string") {
      this.content = JSON.parse(data.content);
    } else if (data.content && typeof data.content === "object") {
      this.content = data.content;
    }
  }
}
