import { WsSequenceValidator } from '@common/websocket/validation/ws-sequence-validator';

describe('WsSequenceValidator', () => {
  let validator: WsSequenceValidator;

  beforeEach(() => {
    validator = new WsSequenceValidator(3);
  });

  describe('first message', () => {
    it('returns initialized for the first message on a stream', () => {
      expect(validator.validate('btcusdt@depth', 100)).toBe('initialized');
    });

    it('sets lastId to the first updateId', () => {
      validator.validate('btcusdt@depth', 100);
      const stats = validator.getStats('btcusdt@depth');
      expect(stats?.lastId).toBe(100);
    });
  });

  describe('in-order messages', () => {
    it('returns ok when firstId === lastId + 1', () => {
      validator.validate('s', 10);
      expect(validator.validate('s', 11, 11)).toBe('ok');
    });

    it('returns ok for a batch range that starts exactly at lastId + 1', () => {
      validator.validate('s', 10);
      expect(validator.validate('s', 15, 11)).toBe('ok');
    });

    it('updates lastId on ok', () => {
      validator.validate('s', 10);
      validator.validate('s', 15, 11);
      expect(validator.getStats('s')?.lastId).toBe(15);
    });
  });

  describe('duplicates', () => {
    it('returns duplicate when updateId <= lastId', () => {
      validator.validate('s', 10);
      expect(validator.validate('s', 10)).toBe('duplicate');
      expect(validator.validate('s', 9)).toBe('duplicate');
    });

    it('increments dupCount on duplicate', () => {
      validator.validate('s', 10);
      validator.validate('s', 10);
      validator.validate('s', 8);
      expect(validator.getStats('s')?.dupCount).toBe(2);
    });
  });

  describe('gaps', () => {
    it('returns gap when firstId > lastId + 1', () => {
      validator.validate('s', 10);
      expect(validator.validate('s', 13, 12)).toBe('gap');
    });

    it('increments gapCount on gap', () => {
      validator.validate('s', 10);
      validator.validate('s', 13, 12);
      expect(validator.getStats('s')?.gapCount).toBe(1);
    });

    it('resets gapCount streak on in-order message after a gap', () => {
      validator.validate('s', 10);
      validator.validate('s', 13, 12);
      validator.validate('s', 15, 14);
      expect(validator.getStats('s')?.gapCount).toBe(0);
    });
  });

  describe('resync', () => {
    it('returns resync when gapCount reaches maxGapsBeforeResync', () => {
      validator.validate('s', 10);
      validator.validate('s', 12, 12); // gap 1
      validator.validate('s', 15, 14); // gap 2
      expect(validator.validate('s', 18, 17)).toBe('resync'); // gap 3 — triggers resync
    });

    it('clears state after resync so next message is initialized', () => {
      validator.validate('s', 10);
      validator.validate('s', 12, 12);
      validator.validate('s', 15, 14);
      validator.validate('s', 18, 17); // resync
      expect(validator.validate('s', 20)).toBe('initialized');
    });

    it('getStats returns null after resync until reinitialized', () => {
      validator.validate('s', 10);
      validator.validate('s', 12, 12);
      validator.validate('s', 15, 14);
      validator.validate('s', 18, 17);
      expect(validator.getStats('s')).toBeNull();
    });
  });

  describe('reset', () => {
    it('reset(streamId) removes state for that stream', () => {
      validator.validate('s', 10);
      validator.reset('s');
      expect(validator.getStats('s')).toBeNull();
    });

    it('reset(streamId) does not affect other streams', () => {
      validator.validate('a', 10);
      validator.validate('b', 20);
      validator.reset('a');
      expect(validator.getStats('b')?.lastId).toBe(20);
    });

    it('resetAll clears all streams', () => {
      validator.validate('a', 10);
      validator.validate('b', 20);
      validator.resetAll();
      expect(validator.getStats('a')).toBeNull();
      expect(validator.getStats('b')).toBeNull();
    });
  });

  describe('independent streams', () => {
    it('tracks each stream separately', () => {
      validator.validate('a', 10);
      validator.validate('b', 50);
      expect(validator.validate('a', 11, 11)).toBe('ok');
      expect(validator.validate('b', 51, 51)).toBe('ok');
    });
  });
});
