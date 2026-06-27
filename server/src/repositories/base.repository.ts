import Database from 'better-sqlite3';

export abstract class BaseRepository<T, CreateDto, UpdateDto> {
  constructor(
    protected readonly db: Database.Database,
    protected readonly tableName: string
  ) {}

  abstract findById(id: string): T | null;
  abstract create(dto: CreateDto): T;
  abstract update(id: string, dto: UpdateDto): T;
  abstract findMany(filter?: Partial<T>): T[];
}
