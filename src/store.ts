import type { CountryCode } from './domain/countries';

export interface Member {
  id: string;
  name: string;
  country: CountryCode;
  /** Always E.164. */
  phone: string;
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
}
