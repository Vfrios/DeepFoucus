declare module 'emoji-dictionary' {
  interface EmojiDictionary {
    getUnicode(name: string): string | undefined;
    names: string[];
  }

  const emoji: EmojiDictionary;
  export = emoji;
}
