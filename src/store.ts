import type { CountryCode } from './domain/countries';
import type { Reconciliation } from './domain/reconciliation';

export interface Member {
  id: string;
  name: string;
  country: CountryCode;
  /** Always E.164. */
  phone: string;
}

export interface Plan {
  /** Caller-chosen, stored byte for byte. */
  id: string;
  country: CountryCode;
  currency: string;
  /** Minor units, before VAT. */
  monthly: number;
  /** Minor units, before VAT. */
  joining_fee: number;
}

export interface Agreement {
  id: string;
  member_id: string;
  plan_id: string;
  /** `YYYY-MM-DD`, already validated. */
  start_date: string;
  due_day: number;
}

/** A stored reconciliation run. Written once and never changed. */
export interface ReconciliationRun extends Reconciliation {
  id: string;
  /** `YYYY-MM`, already validated. */
  month: string;
}

/**
 * All state, in memory. A new store is created per app instance, so every
 * start (and every test) begins empty.
 *
 * Uniqueness rule: Node runs one callback at a time, so a check followed by a
 * `Map.set` with no `await` in between cannot interleave with another request.
 * Keep every check-and-insert below synchronous.
 */
export class Store {
  readonly members = new Map<string, Member>();
  private readonly memberIdByPhone = new Map<string, string>();
  readonly plans = new Map<string, Plan>();
  readonly agreements = new Map<string, Agreement>();
  readonly runs = new Map<string, ReconciliationRun>();

  /** Inserts the member, or returns the id of the member that already owns the phone. */
  addMember(member: Member): { ok: true } | { ok: false; existingId: string } {
    const existingId = this.memberIdByPhone.get(member.phone);
    if (existingId !== undefined) return { ok: false, existingId };
    this.memberIdByPhone.set(member.phone, member.id);
    this.members.set(member.id, member);
    return { ok: true };
  }

  findMemberByPhone(phone: string): Member | undefined {
    const id = this.memberIdByPhone.get(phone);
    return id === undefined ? undefined : this.members.get(id);
  }

  /** Inserts the plan, or returns false when the id is already taken. */
  addPlan(plan: Plan): boolean {
    if (this.plans.has(plan.id)) return false;
    this.plans.set(plan.id, plan);
    return true;
  }

  addAgreement(agreement: Agreement): void {
    this.agreements.set(agreement.id, agreement);
  }

  addRun(run: ReconciliationRun): void {
    this.runs.set(run.id, run);
  }
}
