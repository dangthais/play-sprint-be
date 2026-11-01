/** Tài khoản của chính người đang đăng nhập (không có mật khẩu/hash). */
export interface AuthUser {
  id: string;
  /** Đã chuẩn hoá (trim + chữ thường). */
  email: string;
  displayName: string;
  /** `displayName.toLowerCase()` — khoá duy nhất giữa các tài khoản (ADR-026). */
  displayNameKey: string;
  createdAt: Date;
}

export interface AuthSessionInput {
  id: string;
  /** SHA-256 của token cookie (32 byte) — token không bao giờ được lưu. */
  tokenHash: Buffer;
  createdAt: Date;
  expiresAt: Date;
}

export interface UserWithHash extends AuthUser {
  passwordHash: string;
}

export interface ResolvedAuth {
  user: AuthUser;
  authSessionId: string;
}

/** Vi phạm unique, map theo tên constraint (không đọc `detail` của pg). */
export class AuthConflictError extends Error {
  readonly field: 'EMAIL' | 'NAME';
  constructor(field: 'EMAIL' | 'NAME') {
    super(`${field}_TAKEN`);
    this.name = 'AuthConflictError';
    this.field = field;
  }
}

/**
 * Truy cập dữ liệu tài khoản + phiên đăng nhập. Hai bản (pg, in-memory) cùng ngữ nghĩa, kiểm bằng
 * `auth.repository.suite.ts`. Các thao tác nhiều bước là **atomic** (một transaction).
 */
export interface AuthRepository {
  /**
   * Tạo tài khoản + phiên đăng nhập; xoá phiên `replaceTokenHash` (nếu có). Trùng email → ném
   * `AuthConflictError('EMAIL')` (được kiểm trước tên), trùng tên → `AuthConflictError('NAME')`;
   * khi lỗi không có gì thay đổi.
   */
  register(input: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    displayNameKey: string;
    now: Date;
    session: AuthSessionInput;
    replaceTokenHash: Buffer | null;
  }): Promise<AuthUser>;

  findByEmail(email: string): Promise<UserWithHash | null>;

  findPasswordHash(userId: string): Promise<string | null>;

  /** Phiên khớp hash **và** `expiresAt > now`; ngược lại `null`. */
  findSession(tokenHash: Buffer, now: Date): Promise<ResolvedAuth | null>;

  /**
   * Đăng nhập: trong một transaction, khoá dòng user và chỉ tiếp tục khi `password_hash` hiện tại
   * **vẫn bằng** `verifiedPasswordHash` (hash mà mật khẩu vừa được verify; chống TOCTOU với đổi mật
   * khẩu). Nếu đã đổi / user không còn → trả `false`, không thay đổi gì. Ngược lại: (nếu `rehash`)
   * đổi sang hash mới, xoá phiên `replaceTokenHash` (nếu có), dọn phiên **hết hạn** của chính user,
   * tạo phiên mới và trả `true`.
   */
  startSession(input: {
    userId: string;
    verifiedPasswordHash: string;
    now: Date;
    session: AuthSessionInput;
    replaceTokenHash: Buffer | null;
    /** Hash mới (tham số hiện tại) thay cho `verifiedPasswordHash`, hoặc `null`. */
    rehash: string | null;
  }): Promise<boolean>;

  /** Xoá đúng một phiên theo hash (idempotent). */
  deleteSession(tokenHash: Buffer): Promise<void>;

  /**
   * Đổi mật khẩu: cập nhật hash + `password_changed_at`, xoá **mọi** phiên của user, tạo phiên mới.
   * Trả `false` nếu user không còn tồn tại hoặc hash hiện tại không còn bằng `verifiedPasswordHash`
   * (đã bị đổi đồng thời; toàn bộ thao tác không có hiệu lực).
   */
  changePassword(input: {
    userId: string;
    /** Hash mà `currentPassword` vừa được verify; hash hiện tại đã khác → trả `false` (không đổi gì). */
    verifiedPasswordHash: string;
    passwordHash: string;
    now: Date;
    session: AuthSessionInput;
  }): Promise<boolean>;

  /** Đổi tên hiển thị; tên đã thuộc tài khoản **khác** → `AuthConflictError('NAME')`. `null` nếu user không còn. */
  updateDisplayName(input: {
    userId: string;
    displayName: string;
    displayNameKey: string;
    now: Date;
  }): Promise<AuthUser | null>;

  /** `true` nếu có tài khoản nào dùng khoá tên này (T2: khách không được dùng — `NAME_TAKEN`). */
  isDisplayNameKeyTaken(displayNameKey: string): Promise<boolean>;
}
