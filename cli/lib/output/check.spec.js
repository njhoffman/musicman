const { expect } = require('chai');
const chalk = require('chalk').default;

const { stripAnsi } = require('../utils/logger.js');
const { renderPlan, renderReport } = require('./check.js');

const plain = lines => lines.map(stripAnsi);

describe('Check Output', () => {
  let originalLevel;

  beforeEach(() => {
    originalLevel = chalk.level;
    chalk.level = 1;
  });

  afterEach(() => {
    chalk.level = originalLevel;
  });

  describe('renderReport', () => {
    const findings = Array.from({ length: 12 }, (_, i) => ({ file: `f${i}.mp3`, detail: 'x' }));
    const results = [
      { name: 'drift', description: 'database and files differ', unit: 'file', findings: [] },
      {
        name: 'names',
        description: 'names',
        unit: 'group',
        findings: [{ file: null, detail: 'A / a' }]
      },
      { name: 'spotify-id', description: 'leftover', unit: 'file', findings }
    ];

    it('should report counts, every finding per check, and a summary', () => {
      const lines = plain(renderReport(results));
      expect(lines[0]).to.match(/^drift +ok +database and files differ$/);
      expect(lines[1]).to.match(/^names +1 group +names$/);
      expect(lines[2]).to.equal('    A / a');
      expect(lines).to.include('    f11.mp3  x');
      expect(lines[lines.length - 1]).to.equal('2 checks of 3 found problems');
      expect(plain(renderReport([results[0]])).pop()).to.equal('No problems found in 1 check');
    });

    it('should color names, counts, and paths but keep the columns aligned', () => {
      const lines = renderReport(results);
      expect(lines[0]).to.not.equal(stripAnsi(lines[0]));
      expect(lines[4]).to.include(chalk.hex('#888899')('f0.mp3'));
      // padding is applied before the color, so the plain columns line up
      expect(stripAnsi(lines[0]).indexOf('database')).to.equal(
        stripAnsi(lines[1]).indexOf('names', 5)
      );
    });

    it('should leave the text uncolored without a terminal', () => {
      chalk.level = 0;
      const lines = renderReport(results);
      expect(lines).to.deep.equal(plain(lines));
    });
  });

  describe('renderPlan', () => {
    const plan = {
      files: [
        {
          file: 'a.mp3',
          changes: [
            { check: 'names', text: 'rename Mood to mood' },
            { check: 'names', text: 'remove MOOD (same as mood)' }
          ]
        },
        { file: 'b.mp3', changes: [{ check: 'multi', text: "genre 'a;b' to 'a, b'" }] }
      ],
      skipped: [{ check: 'names', file: 'c.mp3', text: "mood 'x' differs from Mood 'y'" }]
    };

    it('should list counts per check, the changes, and what is left for you', () => {
      const lines = plain(renderPlan(plan));
      expect(lines).to.include('names       2 changes in 1 file, 1 left for you');
      expect(lines).to.include('    a.mp3  rename Mood to mood');
      expect(lines).to.include("    left  c.mp3  mood 'x' differs from Mood 'y'");
      expect(lines).to.include('multi       1 change in 1 file');
    });

    it('should color each change kind by its verb', () => {
      const lines = renderPlan(plan);
      expect(lines.find(line => line.includes('rename'))).to.include(
        chalk.hex('#5599BB').bold('rename')
      );
      expect(lines.find(line => line.includes('remove'))).to.include(
        chalk.hex('#BB7755').bold('remove')
      );
      expect(lines.find(line => line.includes('genre'))).to.include(
        chalk.hex('#33CCAA')("genre 'a;b' to 'a, b'")
      );
    });

    it('should list every change per check', () => {
      const many = {
        files: Array.from({ length: 12 }, (_, i) => ({
          file: `f${i}.mp3`,
          changes: [{ check: 'case', text: "mood 'a' to 'A'" }]
        })),
        skipped: []
      };
      expect(plain(renderPlan(many))).to.include("    f11.mp3  mood 'a' to 'A'");
    });
  });
});
