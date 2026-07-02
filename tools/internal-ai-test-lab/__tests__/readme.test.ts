import * as fs from 'node:fs';
import * as path from 'node:path';

const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf-8');

describe('README — CLI examples do not hardcode passport.pdf as required input', () => {
  it('11. never presents input/passport.pdf as a literal required filename', () => {
    expect(README).not.toContain('input/passport.pdf');
  });

  it('uses a generic placeholder for --file in the quick-start commands', () => {
    expect(README).toContain('<your-test-file>');
  });

  it('documents JPG, PNG, and DOCX support alongside PDF', () => {
    expect(README).toMatch(/\.jpg/i);
    expect(README).toMatch(/\.png/i);
    expect(README).toMatch(/\.docx/i);
  });

  it('explains that file format and business document type are independent', () => {
    expect(README.toLowerCase()).toContain('document type');
    expect(README).toMatch(/independent|never guessed from the filename|separate concepts/i);
  });
});
