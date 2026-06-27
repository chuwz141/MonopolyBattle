export const viErrors = {
  connectionLost: 'Mất kết nối, đang thử kết nối lại...',
  reconnected: 'Đã kết nối lại thành công!',
  serverError: 'Lỗi hệ thống, vui lòng thử lại',
  timeout: 'Hết thời gian chờ',
  invalidInput: 'Dữ liệu không hợp lệ',
  teamNameTaken: 'Tên đội đã được sử dụng',
  decisionLocked: 'Không thể thay đổi quyết định đã gửi',
  quizExpired: 'Đã hết thời gian trả lời',
  unauthorized: 'Không có quyền truy cập',
  invalidToken: 'Token không hợp lệ hoặc đã hết hạn',
  gameNotFound: 'Không tìm thấy trò chơi',
  teamNotFound: 'Không tìm thấy đội chơi',
  playerNotFound: 'Không tìm thấy người chơi',
  forbidden: 'Không có quyền thực hiện hành động này',
};

export class AppError extends Error {
  constructor(
    public readonly messageVi: string,   // User-facing Vietnamese message
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(messageVi);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class GameNotFoundError extends AppError {
  constructor() {
    super(viErrors.gameNotFound, 404, 'GAME_NOT_FOUND');
  }
}

export class TeamNotFoundError extends AppError {
  constructor() {
    super(viErrors.teamNotFound, 404, 'TEAM_NOT_FOUND');
  }
}

export class PlayerNotFoundError extends AppError {
  constructor() {
    super(viErrors.playerNotFound, 404, 'PLAYER_NOT_FOUND');
  }
}
