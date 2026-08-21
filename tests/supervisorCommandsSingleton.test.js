import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

describe('useSupervisorCommands — singleton guard (SEC estática)', () => {
    const src = readFileSync('src/hooks/useSupervisorCommands.js', 'utf8');

    it('SG-01: declara _activeSubscriberCount a nivel de módulo', () => {
        expect(src).toMatch(/let\s+_activeSubscriberCount\s*=/);
    });

    it('SG-02: incrementa el contador en el useEffect', () => {
        expect(src).toMatch(/_activeSubscriberCount\+\+/);
    });

    it('SG-03: decrementa en el cleanup del useEffect', () => {
        expect(src).toMatch(/_activeSubscriberCount--/);
    });

    it('SG-04: retorna early si el contador supera 1', () => {
        expect(src).toMatch(/_activeSubscriberCount\s*>\s*1/);
    });

    it('EMP-01: las altas remotas validan al supervisor sin usar la sesión local', () => {
        expect(src).toContain('saveEmployeeFromSupervisor');
        expect(src).toMatch(/action === 'save_employee'[\s\S]*saveEmployeeFromSupervisor/);
    });
});
