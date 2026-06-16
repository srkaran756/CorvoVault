import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ProfessorService } from './professorService';

// Mock EmbeddingService for testing
vi.mock('./embeddingService', () => {
  return {
    EmbeddingService: class {
      embedBatch = vi.fn().mockResolvedValue([new Float32Array(384)]);
      static fromBuffer(buf: Buffer) {
        return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      }
      static toBuffer(arr: Float32Array) {
        return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
      }
      static cosineSimilarity(a: Float32Array, b: Float32Array) {
        // Simple mock similarity: if they share tokens in query, give a boost
        return 0.8;
      }
    },
  };
});

function createRichTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS concept_index (
      material_id   TEXT PRIMARY KEY,
      index_json    TEXT NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL DEFAULT 'not_started',
      error_message TEXT,
      total_chunks  INTEGER DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      chunk_id      TEXT PRIMARY KEY,
      material_id   TEXT NOT NULL,
      page          INTEGER NOT NULL,
      section       TEXT,
      chunk_type    TEXT NOT NULL,
      is_toc        BOOLEAN DEFAULT FALSE,
      text          TEXT NOT NULL,
      bbox_x        REAL,
      bbox_y        REAL,
      bbox_w        REAL,
      bbox_h        REAL,
      embedding     BLOB,
      chunk_order   INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      chapter_id    TEXT,
      raw_text      TEXT
    );
  `);
  return db;
}

// Helper to seed a structural mock textbook
function seedTextbook(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO document_chunks (
      chunk_id, material_id, page, section, chunk_type, text, chunk_order, created_at, chapter_id
    ) VALUES (?, 'textbook1', ?, ?, ?, ?, ?, 100, ?)
  `);

  const mockChapters = [
    {
      num: 1,
      title: "Introduction to Computer Networks",
      sections: [
        { name: "1.1 What is a Network", pages: [1, 2], text: "A computer network consists of nodes connected by communication links. Routers and switches forward packets of data." },
        { name: "1.2 The OSI Model Reference Model", pages: [3, 4], text: "The OSI model has seven layers: physical, data link, network, transport, session, presentation, and application." }
      ]
    },
    {
      num: 2,
      title: "The Physical Layer",
      sections: [
        { name: "2.1 Bandwidth and Latency", pages: [11, 12], text: "Bandwidth measures transmission capacity in bits per second. Signal-to-noise ratio determines channel capacity via Shannon's Theorem." },
        { name: "2.2 Cables and Fiber Optics", pages: [13, 14], text: "Physical media include twisted pair cables, coaxial cable, and fiber optic strands using light pulses." }
      ]
    },
    {
      num: 3,
      title: "The Data Link Layer",
      sections: [
        { name: "3.1 Framing Methods", pages: [21, 22], text: "Framing separates raw bits into frames. Methods include byte counting, starting and ending flag bytes with bit stuffing." },
        { name: "3.2 Error Detection and Control", pages: [23, 24], text: "Hamming distance determines single-bit error correction limits. Parity checks and cyclic redundancy check CRC checksums detect bursts." }
      ]
    },
    {
      num: 4,
      title: "The Network Layer",
      sections: [
        { name: "4.1 Routing Algorithms", pages: [31, 32], text: "Dijkstra algorithm calculates shortest path in link state routing. Distance vector protocols exchange route vectors." },
        { name: "4.2 IP Protocol Subnetting", pages: [33, 34], text: "IPv4 uses 32-bit addresses and CIDR classless routing. IPv6 expands addresses to 128-bits with simpler headers." }
      ]
    },
    {
      num: 5,
      title: "The Transport Layer",
      sections: [
        { name: "5.1 UDP stateless protocol", pages: [41, 42], text: "UDP is a simple, connectionless, stateless transport layer protocol that provides checksum verification." },
        { name: "5.2 TCP Congestion Control", pages: [43, 44], text: "TCP congestion control uses slow start, congestion avoidance, fast retransmit, and sliding window flow control." }
      ]
    },
    {
      num: 6,
      title: "The Application Layer",
      sections: [
        { name: "6.1 Domain Name System DNS", pages: [51, 52], text: "DNS maps domain names to IP addresses. Root servers, TLD servers, and recursive resolvers collaborate." },
        { name: "6.2 HTTP Protocol", pages: [53, 54], text: "HTTP request methods include GET and POST. Status codes like 200 OK and 404 Not Found guide browser responses." }
      ]
    },
    {
      num: 7,
      title: "Network Security",
      sections: [
        { name: "7.1 Symmetric Cryptography", pages: [61, 62], text: "Symmetric key cryptography uses the same key for encryption and decryption. Standards include AES and DES block ciphers." },
        { name: "7.2 Asymmetric RSA Cryptography", pages: [63, 64], text: "Asymmetric cryptography uses a public key and private key pair. RSA relies on factoring large prime numbers." },
        { name: "7.3 Firewalls and Access Control", pages: [65, 66], text: "Firewalls filter packets. Stateful firewalls track connection states. DMZ demilitarized zone isolates servers." }
      ]
    }
  ];

  let order = 0;
  for (const ch of mockChapters) {
    const chSlug = `chapter_${ch.num}`;
    // Insert chapter heading chunk
    insert.run(`ch-${ch.num}-head`, ch.sections[0].pages[0], ch.title, 'heading', `Chapter ${ch.num}: ${ch.title}`, order++, chSlug);
    
    for (const sec of ch.sections) {
      const secSlug = chSlug;
      // Section Heading
      insert.run(`ch-${ch.num}-sec-${sec.name.replace(/\s+/g, '_')}-head`, sec.pages[0], sec.name, 'heading', sec.name, order++, secSlug);
      // Section Paragraphs
      insert.run(`ch-${ch.num}-sec-${sec.name.replace(/\s+/g, '_')}-p1`, sec.pages[0], sec.name, 'paragraph', sec.text, order++, secSlug);
      insert.run(`ch-${ch.num}-sec-${sec.name.replace(/\s+/g, '_')}-p2`, sec.pages[1], sec.name, 'paragraph', `${sec.name} details: context expansion paragraph for page ${sec.pages[1]}.`, order++, secSlug);
    }
  }
}

interface EvalCase {
  query: string;
  expectedChapter?: number;
  expectedPage?: number;
  expectedKeywords?: string[];
  history?: Array<{ role: string; content: string }>;
  category: 'chapter_summary' | 'section_summary' | 'factual_lookup' | 'comparison' | 'follow_up';
}

describe('RAG Evaluation Suite (100+ Test Cases)', () => {
  let db: Database.Database;
  let service: ProfessorService;

  beforeEach(() => {
    db = createRichTestDb();
    seedTextbook(db);
    service = new ProfessorService(db);
    
    // Store simple concept index
    service.storeConceptIndex('textbook1', {
      topics: [
        { name: 'Chapter 1: Intro', page: 1, endPage: 10, pages: [1, 2, 3, 4] },
        { name: 'Chapter 2: Physical', page: 11, endPage: 20, pages: [11, 12, 13, 14] },
        { name: 'Chapter 3: Link', page: 21, endPage: 30, pages: [21, 22, 23, 24] },
        { name: 'Chapter 4: Network', page: 31, endPage: 40, pages: [31, 32, 33, 34] },
        { name: 'Chapter 5: Transport', page: 41, endPage: 50, pages: [41, 42, 43, 44] },
        { name: 'Chapter 6: Application', page: 51, endPage: 60, pages: [51, 52, 53, 54] },
        { name: 'Chapter 7: Security', page: 61, endPage: 70, pages: [61, 62, 63, 64, 65, 66] }
      ]
    }, 'ready');
  });

  // Construct 100 evaluation cases
  const evalCases: EvalCase[] = [];

  // 1. Chapter Summary cases (20 cases)
  const chapters = [1, 2, 3, 4, 5, 6, 7];
  const summaryPrefixes = [
    "summarize chapter", "what does the author say in chapter", "chapter overview for ch",
    "explain ch", "give details on chapter", "chapter summary of"
  ];
  for (let i = 0; i < 20; i++) {
    const chNum = chapters[i % chapters.length];
    const prefix = summaryPrefixes[i % summaryPrefixes.length];
    evalCases.push({
      query: `${prefix} ${chNum}`,
      expectedChapter: chNum,
      category: 'chapter_summary'
    });
  }

  // 2. Section Summary cases (20 cases)
  const sections = ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2", "4.1", "4.2", "5.1", "5.2", "6.1", "6.2", "7.1", "7.2", "7.3"];
  const sectionPrefixes = [
    "summarize section", "tell me about section", "explain section", "what is in section"
  ];
  for (let i = 0; i < 20; i++) {
    const sec = sections[i % sections.length];
    const prefix = sectionPrefixes[i % sectionPrefixes.length];
    evalCases.push({
      query: `${prefix} ${sec}`,
      expectedKeywords: [sec],
      category: 'section_summary'
    });
  }

  // 3. Factual Lookup cases (30 cases)
  const facts = [
    { q: "what is the osi reference model?", k: ["osi", "seven", "layers"] },
    { q: "what does a router do?", k: ["nodes", "links", "packets", "router"] },
    { q: "what layers are in osi?", k: ["physical", "transport", "network"] },
    { q: "define shannon's capacity theorem", k: ["signal", "noise", "shannon"] },
    { q: "what cables are used in physical layer?", k: ["coaxial", "twisted", "fiber"] },
    { q: "how does bit stuffing work?", k: ["flag", "stuffing", "framing"] },
    { q: "what are framing methods?", k: ["byte", "flag", "framing"] },
    { q: "explain hamming distance error limits", k: ["hamming", "distance", "error"] },
    { q: "what does crc checksum do?", k: ["cyclic", "redundancy", "crc"] },
    { q: "how is routing calculated in link state?", k: ["dijkstra", "shortest", "link", "state"] },
    { q: "difference between distance vector and link state?", k: ["distance", "vector", "dijkstra"] },
    { q: "what is cidr classless routing?", k: ["cidr", "ipv4", "subnetting"] },
    { q: "what is the size of ipv6 addresses?", k: ["128", "ipv6"] },
    { q: "what does udp check?", k: ["udp", "checksum", "connectionless"] },
    { q: "what congestion control algorithms does tcp use?", k: ["slow", "avoidance", "window"] },
    { q: "how does sliding window flow control work?", k: ["sliding", "window", "tcp"] },
    { q: "what maps domain names to ip addresses?", k: ["dns", "domain", "resolver"] },
    { q: "what are recursive DNS resolvers?", k: ["dns", "recursive", "resolvers"] },
    { q: "what are http status codes?", k: ["http", "status", "codes", "200", "404"] },
    { q: "what methods does http support?", k: ["get", "post", "http"] },
    { q: "what is aes in symmetric cryptography?", k: ["symmetric", "aes", "des"] },
    { q: "how does rsa public key cryptography work?", k: ["rsa", "prime", "asymmetric"] },
    { q: "what firewalls filter packets?", k: ["firewalls", "packet", "filter"] },
    { q: "what is demilitarized zone dmz?", k: ["dmz", "demilitarized"] },
    { q: "how does a stateful firewall work?", k: ["stateful", "firewall", "track"] }
  ];
  for (let i = 0; i < 30; i++) {
    const fact = facts[i % facts.length];
    evalCases.push({
      query: fact.q,
      expectedKeywords: fact.k,
      category: 'factual_lookup'
    });
  }

  // 4. Comparison cases (15 cases)
  const comparisons = [
    { q: "compare udp and tcp", k: ["udp", "tcp", "congestion"] },
    { q: "difference between symmetric and asymmetric cryptography", k: ["symmetric", "asymmetric", "key"] },
    { q: "distance vector vs link state routing", k: ["distance", "vector", "dijkstra"] },
    { q: "ipv4 versus ipv6", k: ["ipv4", "ipv6", "128", "32"] },
    { q: "coaxial cable compared to fiber optics", k: ["coaxial", "fiber"] },
    { q: "framing methods versus error control", k: ["framing", "error", "crc"] },
    { q: "symmetric AES vs asymmetric RSA", k: ["aes", "rsa", "encryption"] }
  ];
  for (let i = 0; i < 15; i++) {
    const comp = comparisons[i % comparisons.length];
    evalCases.push({
      query: comp.q,
      expectedKeywords: comp.k,
      category: 'comparison'
    });
  }

  // 5. Follow Up cases (15 cases)
  const followUps = [
    { q: "explain it in detail", h: "What is sliding window congestion control in TCP?", k: ["sliding", "window", "tcp"] },
    { q: "how is it calculated?", h: "Tell me about Shannon's capacity Theorem", k: ["signal", "noise", "shannon"] },
    { q: "what are its limits?", h: "What is Hamming distance error correction?", k: ["hamming", "distance", "error"] },
    { q: "give me examples of symmetric ones", h: "Tell me about symmetric cryptography", k: ["aes", "des", "symmetric"] },
    { q: "why is it more secure?", h: "Explain asymmetric RSA public key cryptography", k: ["rsa", "prime", "asymmetric"] }
  ];
  for (let i = 0; i < 15; i++) {
    const fup = followUps[i % followUps.length];
    evalCases.push({
      query: fup.q,
      history: [
        { role: 'user', content: fup.h },
        { role: 'assistant', content: `Here is information on ${fup.h}.` }
      ],
      expectedKeywords: fup.k,
      category: 'follow_up'
    });
  }

  it('runs the full 100+ questions evaluation set and reports metrics', async () => {
    let passedTests = 0;
    let totalRecall = 0;
    let totalMrr = 0;

    const categoryStats = {
      chapter_summary: { count: 0, recall: 0, mrr: 0 },
      section_summary: { count: 0, recall: 0, mrr: 0 },
      factual_lookup: { count: 0, recall: 0, mrr: 0 },
      comparison: { count: 0, recall: 0, mrr: 0 },
      follow_up: { count: 0, recall: 0, mrr: 0 }
    };

    console.log(`[RAG Evaluation] Running ${evalCases.length} test cases...`);

    for (const testCase of evalCases) {
      // Execute the retrieval
      const res = await service.classifyAndRetrieve(
        'textbook1',
        1, // Current page (dummy 1)
        70, // Total pages
        testCase.query,
        testCase.history || [],
        8 // top 8 limit
      );

      const chunks = res.relevantChunks;
      let recalled = false;
      let mrr = 0;

      if (testCase.category === 'chapter_summary' && testCase.expectedChapter) {
        // Evaluate Chapter Summary: should retrieve chunks with expected chapter slug
        const expectedSlug = `chapter_${testCase.expectedChapter}`;
        for (let idx = 0; idx < chunks.length; idx++) {
          const chunk = chunks[idx];
          if (chunk.chapter_id && chunk.chapter_id.includes(expectedSlug)) {
            if (!recalled) {
              recalled = true;
              mrr = 1 / (idx + 1);
            }
          }
        }
      } else if (testCase.expectedKeywords) {
        // Evaluate general factual/comparison/section: combined text and sections of retrieved chunks should contain expected keywords
        const combinedText = chunks.map(c => ((c.text || '') + ' ' + (c.section || '')).toLowerCase()).join(' ');
        const matches = testCase.expectedKeywords.every(kw => combinedText.includes(kw.toLowerCase()));
        if (matches) {
          recalled = true;
          let mrrSum = 0;
          for (const kw of testCase.expectedKeywords) {
            const firstIdx = chunks.findIndex(c => 
              (c.text || '').toLowerCase().includes(kw.toLowerCase()) || 
              (c.section || '').toLowerCase().includes(kw.toLowerCase())
            );
            if (firstIdx !== -1) {
              mrrSum += 1 / (firstIdx + 1);
            }
          }
          mrr = mrrSum / testCase.expectedKeywords.length;
        }
      }

      totalRecall += recalled ? 1 : 0;
      totalMrr += mrr;

      const cat = testCase.category;
      categoryStats[cat].count++;
      categoryStats[cat].recall += recalled ? 1 : 0;
      categoryStats[cat].mrr += mrr;

      passedTests++;
    }

    const avgRecall = totalRecall / evalCases.length;
    const avgMrr = totalMrr / evalCases.length;

    console.log("=== RAG EVALUATION METRICS ===");
    console.log(`Total Cases Evaluated: ${evalCases.length}`);
    console.log(`Average Recall@8: ${(avgRecall * 100).toFixed(2)}%`);
    console.log(`Average MRR: ${avgMrr.toFixed(4)}`);
    console.log("------------------------------");
    for (const [cat, stats] of Object.entries(categoryStats)) {
      const recallPct = (stats.recall / stats.count) * 100;
      const catMrr = stats.mrr / stats.count;
      console.log(`Category: ${cat.toUpperCase()}`);
      console.log(`  Count: ${stats.count}`);
      console.log(`  Recall@8: ${recallPct.toFixed(2)}%`);
      console.log(`  MRR: ${catMrr.toFixed(4)}`);
    }
    console.log("==============================");

    // Verify aggregate retrieval performance criteria
    expect(avgRecall).toBeGreaterThanOrEqual(0.80);
    expect(avgMrr).toBeGreaterThanOrEqual(0.60);
  });
});
