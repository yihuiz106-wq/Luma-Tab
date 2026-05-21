import type { BookmarkCategory, PinnedPage } from '../types/app';

export const mockPinnedPages: PinnedPage[] = [
  { id: 'github', title: 'GitHub', url: 'https://github.com', sourcePath: 'Developer Tools' },
  { id: 'gmail', title: 'Gmail', url: 'https://mail.google.com', sourcePath: 'Daily Tools' },
  { id: 'linear', title: 'Linear', url: 'https://linear.app', sourcePath: 'Workflow' },
  { id: 'notion', title: 'Notion', url: 'https://www.notion.so', sourcePath: 'Workflow' },
  { id: 'figma', title: 'Figma', url: 'https://www.figma.com', sourcePath: 'Design Tools' },
  { id: 'youtube', title: 'YouTube', url: 'https://www.youtube.com', sourcePath: 'Entertainment' }
];

export const mockBookmarkCategories: BookmarkCategory[] = [
  {
    id: 'dev-tools',
    title: '🛠 Developer Tools',
    bookmarks: [
      {
        id: 'stackoverflow',
        title: 'Stack Overflow',
        url: 'https://stackoverflow.com',
        sourcePath: '🛠 Developer Tools'
      },
      {
        id: 'mdn',
        title: 'MDN Web Docs',
        url: 'https://developer.mozilla.org',
        sourcePath: '🛠 Developer Tools'
      },
      {
        id: 'vite',
        title: 'Vite',
        url: 'https://vite.dev',
        sourcePath: '🛠 Developer Tools'
      },
      {
        id: 'typescript',
        title: 'TypeScript',
        url: 'https://www.typescriptlang.org',
        sourcePath: '🛠 Developer Tools'
      }
    ],
    isVirtual: true
  },
  {
    id: 'daily',
    title: '📚 Everyday Reading',
    bookmarks: [
      {
        id: 'bilibili',
        title: 'Bilibili',
        url: 'https://www.bilibili.com',
        sourcePath: '📚 Everyday Reading'
      },
      {
        id: 'sspai',
        title: 'SSPai',
        url: 'https://sspai.com',
        sourcePath: '📚 Everyday Reading'
      },
      {
        id: 'okjike',
        title: 'Jike',
        url: 'https://okjike.com',
        sourcePath: '📚 Everyday Reading'
      }
    ],
    isVirtual: true
  },
  {
    id: 'learning',
    title: '🧠 Learning Resources',
    bookmarks: [
      {
        id: 'coursera',
        title: 'Coursera',
        url: 'https://www.coursera.org',
        sourcePath: '🧠 Learning Resources'
      },
      {
        id: 'youtube-edu',
        title: 'YouTube EDU',
        url: 'https://www.youtube.com',
        sourcePath: '🧠 Learning Resources'
      },
      {
        id: 'zhihu',
        title: 'Zhihu',
        url: 'https://www.zhihu.com',
        sourcePath: '🧠 Learning Resources'
      }
    ],
    isVirtual: true
  }
];
