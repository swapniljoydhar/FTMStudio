// ===========================================================================
// offscreen/tabular.js — CSV parser (Papa Parse, correct chunk/abort usage)
// ===========================================================================
// CSV moved out of the content script: Papa Parse could never be reached from
// the isolated world, so every CSV silently fell back to a naive line splitter
// (broken on quoted newlines) and every streamed CSV threw.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const T = FTM.text;

  function decode(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function bufferedTable(text) {
    const Papa = self.Papa;
    const result = Papa.parse(text, { skipEmptyLines: true });
    if (!result.data.length) return '# CSV Data\n\n```\n' + text + '\n```';
    return T.markdownTable(result.data, '# CSV Data');
  }

  // True streaming writer: rows are appended, never buffered as a matrix, and
  // the header width is fixed from the first row so bodies stay aligned.
  class TableWriter {
    constructor(title, maxRows) {
      this.title = title || '# CSV Data (Streamed)';
      this.maxRows = maxRows || FTM.CONSTANTS.MAX_CSV_ROWS;
      this.parts = [];
      this.cols = 0;
      this.rows = 0;
      this.truncated = false;
    }

    get full() { return this.rows >= this.maxRows; }

    line(row) {
      return T.tableLine(row, this.cols, (v) => T.sanitizeAndEscapeCell(v)) + '\n';
    }

    // Returns false once the row cap is hit so the caller can abort the parser.
    push(row) {
      if (!row || (row.length === 1 && row[0] === '')) return true;
      if (this.full) { this.truncated = true; return false; }
      if (this.cols === 0) {
        this.cols = row.length;
        this.parts.push(this.line(row), T.separatorLine(this.cols) + '\n');
      } else {
        this.parts.push(this.line(row));
      }
      this.rows++;
      return true;
    }

    finish() {
      const note = this.truncated ? '\n*Output truncated at ' + this.maxRows + ' rows.*\n' : '';
      return this.title + '\n\n' + this.parts.join('') + note;
    }
  }

  function streamTable(bytes) {
    const Papa = self.Papa;
    const writer = new TableWriter();
    const source = new Blob([bytes], { type: 'text/csv' });
    return new Promise((resolve, reject) => {
      Papa.parse(source, {
        skipEmptyLines: true,
        chunkSize: FTM.CONSTANTS.MB,
        // Papa passes the parser as the second argument; the old code called
        // results.abort(), which throws and killed every streamed CSV.
        chunk(results, parser) {
          for (const row of results.data) if (!writer.push(row)) { parser.abort(); resolve(writer.finish()); return; }
        },
        complete() { resolve(writer.finish()); },
        error(err) { reject(new Error('Stream CSV failed: ' + err.message)); }
      });
    });
  }

  async function parseCsv(bytes, meta) {
    await FTM.libs.get('papa');
    if (meta.streaming) return streamTable(bytes);
    return bufferedTable(decode(bytes));
  }

  FTM.parsers = FTM.parsers || {};
  FTM.parsers['.csv'] = parseCsv;
  FTM.TableWriter = TableWriter;
})();
