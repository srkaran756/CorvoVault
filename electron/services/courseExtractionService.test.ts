import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  CourseExtractionService, 
  ClassifiedLink,
  getUrlScore,
  getExtensionScore,
  getKeywordScore,
  parseYoutubePlaylist
} from './courseExtractionService';

vi.mock('./embeddingService', () => {
  return {
    EmbeddingService: class {
      embedBatch = vi.fn().mockResolvedValue([
        new Float32Array(384).fill(0.1),
        new Float32Array(384).fill(0.2),
        new Float32Array(384).fill(0.3),
        new Float32Array(384).fill(0.4),
        new Float32Array(384).fill(0.5),
        new Float32Array(384).fill(0.6),
        new Float32Array(384).fill(0.7)
      ]);
      static cosineSimilarity(a: Float32Array, b: Float32Array) {
        if (a[0] === b[0]) return 1.0;
        return 0.5;
      }
    }
  };
});

describe('CourseExtractionService', () => {
  let mockDb: any;
  let service: CourseExtractionService;

  beforeEach(() => {
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn(),
        run: vi.fn()
      })
    };
    service = new CourseExtractionService(mockDb);
  });

  describe('detectSPA', () => {
    it('detects a page as static if it has plenty of links and content', () => {
      const mockHtml = `
        <html>
          <body>
            <h1>Syllabus</h1>
            <ul>
              <li><a href="https://example.com/lec1">Lecture 1</a></li>
              <li><a href="https://example.com/lec2">Lecture 2</a></li>
              <li><a href="https://example.com/lec3">Lecture 3</a></li>
              <li><a href="https://example.com/lec4">Lecture 4</a></li>
              <li><a href="https://example.com/lec5">Lecture 5</a></li>
              <li><a href="https://example.com/lec6">Lecture 6</a></li>
              <li><a href="https://example.com/lec7">Lecture 7</a></li>
              <li><a href="https://example.com/lec8">Lecture 8</a></li>
              <li><a href="https://example.com/lec9">Lecture 9</a></li>
              <li><a href="https://example.com/lec10">Lecture 10</a></li>
              <li><a href="https://example.com/lec11">Lecture 11</a></li>
            </ul>
          </body>
        </html>
      `;
      const links = service.extractLinksFromHtml(mockHtml, 'https://example.com');
      const isSPA = service.detectSPA(mockHtml, links);
      expect(isSPA).toBe(false);
    });

    it('detects a page as SPA if it has very few links and root id', () => {
      const mockHtml = `
        <html>
          <body>
            <div id="root">Loading syllabus app...</div>
            <script src="/bundle.js"></script>
          </body>
        </html>
      `;
      const links = service.extractLinksFromHtml(mockHtml, 'https://example.com');
      const isSPA = service.detectSPA(mockHtml, links);
      expect(isSPA).toBe(true);
    });

    it('detects a page as SPA if Next.js/React framework fingerprint is found', () => {
      const mockHtml = `
        <html>
          <body>
            <div id="__next">Hello</div>
            <a href="/abc">Link</a>
          </body>
        </html>
      `;
      const links = service.extractLinksFromHtml(mockHtml, 'https://example.com');
      const isSPA = service.detectSPA(mockHtml, links);
      expect(isSPA).toBe(true);
    });
  });

  describe('extractLinksFromHtml', () => {
    it('correctly extracts links, DOM paths, and nearest ancestor headings', () => {
      const html = `
        <html>
          <body>
            <div id="main-content">
              <h2>Unit 1: Introduction</h2>
              <p>Welcome to CS101. Here is the first notes file:</p>
              <div>
                <a href="/notes1.pdf">Lecture Notes 1</a>
              </div>
              <h2>Unit 2: Algorithms</h2>
              <ul>
                <li>
                  <a href="/ps1.html">Problem Set 1</a>
                </li>
              </ul>
            </div>
          </body>
        </html>
      `;
      const results = service.extractLinksFromHtml(html, 'https://example.com/course/');
      
      expect(results).toHaveLength(2);
      expect(results[0].url).toBe('https://example.com/notes1.pdf');
      expect(results[0].anchorText).toBe('Lecture Notes 1');
      expect(results[0].nearbyHeading).toBe('Unit 1: Introduction');
      expect(results[0].domPath).toContain('div#main-content');

      expect(results[1].url).toBe('https://example.com/ps1.html');
      expect(results[1].anchorText).toBe('Problem Set 1');
      expect(results[1].nearbyHeading).toBe('Unit 2: Algorithms');
    });
  });

  describe('groupLinks', () => {
    it('groups links by nearby heading and sorts resources and groups', () => {
      const mockLinks: ClassifiedLink[] = [
        {
          url: 'https://example.com/video1',
          anchorText: 'Video 1',
          nearbyHeading: 'Week 2: Advanced Topics',
          surroundingText: 'Some text',
          domPath: 'div > a',
          sourceDomain: 'example.com',
          category: 'Video',
          confidence: 0.9
        },
        {
          url: 'https://example.com/assign1',
          anchorText: 'Assign 1',
          nearbyHeading: 'Week 1: Introduction',
          surroundingText: 'Some text',
          domPath: 'div > a',
          sourceDomain: 'example.com',
          category: 'Assignment',
          confidence: 0.8
        },
        {
          url: 'https://example.com/notes1',
          anchorText: 'Notes 1',
          nearbyHeading: 'Week 1: Introduction',
          surroundingText: 'Some text',
          domPath: 'div > a',
          sourceDomain: 'example.com',
          category: 'Notes',
          confidence: 0.95
        }
      ];

      const grouped = service.groupLinks(mockLinks);

      // Verify groups sorted numerically: Week 1 before Week 2
      expect(grouped).toHaveLength(2);
      expect(grouped[0].groupName).toBe('Week 1: Introduction');
      expect(grouped[1].groupName).toBe('Week 2: Advanced Topics');

      // Verify resources in Week 1 are sorted: Assignment (priority 1) before Notes (priority 4)
      expect(grouped[0].resources).toHaveLength(2);
      expect(grouped[0].resources[0].category).toBe('Assignment');
      expect(grouped[0].resources[1].category).toBe('Notes');
    });

    it('falls back to URL segments when headings are missing', () => {
      const mockLinks: ClassifiedLink[] = [
        {
          url: 'https://example.com/week2/notes.pdf',
          anchorText: 'Lecture Notes',
          nearbyHeading: '',
          surroundingText: '',
          domPath: 'a',
          sourceDomain: 'example.com',
          category: 'Notes',
          confidence: 0.9
        },
        {
          url: 'https://example.com/week1/lab.py',
          anchorText: 'Lab Code',
          nearbyHeading: '',
          surroundingText: '',
          domPath: 'a',
          sourceDomain: 'example.com',
          category: 'Project',
          confidence: 0.8
        }
      ];

      const grouped = service.groupLinks(mockLinks);

      expect(grouped).toHaveLength(2);
      expect(grouped[0].groupName).toBe('Week 1');
      expect(grouped[1].groupName).toBe('Week 2');
    });
  });

  describe('Heuristic Rule Helpers', () => {
    it('getUrlScore correctly weights domains and URLs', () => {
      expect(getUrlScore('https://youtube.com/watch?v=123', 'Video')).toBe(1.0);
      expect(getUrlScore('https://youtu.be/123', 'Video')).toBe(1.0);
      expect(getUrlScore('https://github.com/user/repo', 'Project')).toBe(1.0);
      expect(getUrlScore('https://example.com/assignments/hw1', 'Assignment')).toBe(0.8);
      expect(getUrlScore('https://example.com/readings/chap1', 'Reading')).toBe(0.8);
      expect(getUrlScore('https://example.com/other', 'Video')).toBe(0.0);
    });

    it('getExtensionScore resolves file extensions properly', () => {
      expect(getExtensionScore('https://example.com/slide.pdf', 'Reading')).toBe(1.0);
      expect(getExtensionScore('https://example.com/slide.pdf', 'Notes')).toBe(0.7);
      expect(getExtensionScore('https://example.com/video.mp4', 'Video')).toBe(1.0);
      expect(getExtensionScore('https://example.com/notebook.ipynb', 'Project')).toBe(1.0);
      expect(getExtensionScore('https://example.com/script.py', 'Assignment')).toBe(0.6);
      expect(getExtensionScore('https://example.com/no-extension', 'Reading')).toBe(0.0);
    });

    it('getKeywordScore counts matching regex words correctly', () => {
      expect(getKeywordScore('Homework 1: Problem Set', 'Assignment')).toBe(1.0); // multiple matches
      expect(getKeywordScore('Syllabus and Schedule', 'Other')).toBe(1.0);
      expect(getKeywordScore('Slides for Lecture 1', 'Notes')).toBe(0.6); // 1 match
      expect(getKeywordScore('Random text', 'Assignment')).toBe(0.0);
    });
  });

  describe('parseYoutubePlaylist', () => {
    it('extracts video links from ytInitialData playlist JSON structure', () => {
      const mockHtml = `
        <html>
          <body>
            <script>
              var ytInitialData = {
                "contents": {
                  "twoColumnBrowseResultsRenderer": {
                    "tabs": [{
                      "tabRenderer": {
                        "content": {
                          "sectionListRenderer": {
                            "contents": [{
                              "itemSectionRenderer": {
                                "contents": [{
                                  "playlistVideoListRenderer": {
                                    "contents": [
                                      {
                                        "playlistVideoRenderer": {
                                          "videoId": "abc12345678",
                                          "title": { "runs": [{ "text": "Lecture 1: Intro" }] }
                                        }
                                      },
                                      {
                                        "playlistVideoRenderer": {
                                          "videoId": "xyz98765432",
                                          "title": { "simpleText": "Lecture 2: Advanced" }
                                        }
                                      }
                                    ]
                                  }
                                }]
                              }
                            }]
                          }
                        }
                      }
                    }]
                  }
                }
              };
            </script>
          </body>
        </html>
      `;

      const videos = parseYoutubePlaylist(mockHtml);
      expect(videos).toHaveLength(2);
      expect(videos[0].url).toBe('https://www.youtube.com/watch?v=abc12345678');
      expect(videos[0].title).toBe('Lecture 1: Intro');
      expect(videos[1].url).toBe('https://www.youtube.com/watch?v=xyz98765432');
      expect(videos[1].title).toBe('Lecture 2: Advanced');
    });

    it('falls back to regex parsing if ytInitialData JSON is missing or malformed', () => {
      const mockHtml = `
        <div>
          "videoId":"vidId123456","title":{"runs":[{"text":"Fallback Video 1"
          "videoId":"vidId789012","title":{"runs":[{"text":"Fallback Video 2"
        </div>
      `;

      const videos = parseYoutubePlaylist(mockHtml);
      expect(videos).toHaveLength(2);
      expect(videos[0].url).toBe('https://www.youtube.com/watch?v=vidId123456');
      expect(videos[0].title).toBe('Fallback Video 1');
    });
  });
});
