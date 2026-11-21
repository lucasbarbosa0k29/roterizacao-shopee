// Keep the original UTF-8 bytes outside V8's object heap. Only the record
// being indexed or queried is materialized, including all original geometry.
export class JsonObjectTable<T> {
  constructor(private readonly bytes: Buffer) {}

  private endOfObject(start: number) {
    let depth = 0;
    let quoted = false;
    for (let i = start; i < this.bytes.length; i++) {
      const byte = this.bytes[i];
      if (quoted) {
        if (byte === 92) i++; // escaped byte inside a JSON string
        else if (byte === 34) quoted = false;
      } else if (byte === 34) quoted = true;
      else if (byte === 123) depth++;
      else if (byte === 125 && --depth === 0) return i + 1;
    }
    throw new Error("Incomplete cadastral record");
  }

  read(offset: number): T {
    return JSON.parse(this.bytes.toString("utf8", offset, this.endOfObject(offset)));
  }

  index(kind: "array" | "features", visit: (record: T, offset: number) => void) {
    const start = this.bytes.indexOf(91);
    if (start < 0 || start > 4096) throw new Error("Invalid cadastral array header");
    const prefix = this.bytes.toString("utf8", 0, start);
    if (kind === "features" && !/"features"\s*:\s*$/.test(prefix)) throw new Error("Missing GeoJSON features");
    let i = start + 1;
    let count = 0;
    const skipWhitespace = () => {
      while ([32, 10, 13, 9].includes(this.bytes[i])) i++;
    };
    skipWhitespace();
    while (this.bytes[i] !== 93) {
      if (count > 0) {
        if (this.bytes[i++] !== 44) throw new Error("Invalid cadastral array separator");
        skipWhitespace();
      }
      if (this.bytes[i] !== 123) throw new Error("Expected cadastral object");
      const end = this.endOfObject(i);
      visit(JSON.parse(this.bytes.toString("utf8", i, end)), i);
      count++;
      i = end;
      skipWhitespace();
    }
    const wrapper = JSON.parse(prefix + "[]" + this.bytes.toString("utf8", i + 1));
    if (kind === "features" ? wrapper?.type !== "FeatureCollection" : !Array.isArray(wrapper)) {
      throw new Error("Invalid cadastral dataset");
    }
    return count;
  }
}
