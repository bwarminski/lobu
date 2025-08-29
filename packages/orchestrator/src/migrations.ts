import { DatabasePool } from './database-pool';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export class MigrationRunner {
  private dbPool: DatabasePool;
  private migrationsPath: string;

  constructor(dbPool: DatabasePool, migrationsPath?: string) {
    this.dbPool = dbPool;
    // Default to db/migrations from project root
    this.migrationsPath = migrationsPath || join(process.cwd(), 'db', 'migrations');
  }

  /**
   * Ensure migrations table exists
   */
  private async ensureMigrationsTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      );
    `;
    
    await this.dbPool.query(sql);
    console.log('✅ Migrations table ensured');
  }

  /**
   * Get applied migrations from database
   */
  private async getAppliedMigrations(): Promise<Set<number>> {
    const result = await this.dbPool.query('SELECT version FROM schema_migrations ORDER BY version');
    return new Set(result.rows.map((row: any) => row.version));
  }

  /**
   * Load migration files from disk
   */
  private loadMigrationFiles(): Migration[] {
    if (!existsSync(this.migrationsPath)) {
      console.log(`📁 Migrations directory not found at ${this.migrationsPath}, creating empty list`);
      return [];
    }

    const files = readdirSync(this.migrationsPath)
      .filter(file => file.endsWith('.sql'))
      .sort();

    const migrations: Migration[] = [];
    
    for (const file of files) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) {
        console.warn(`⚠️  Skipping invalid migration file: ${file}`);
        continue;
      }

      const version = parseInt(match[1], 10);
      const name = match[2].replace(/_/g, ' ');
      const sql = readFileSync(join(this.migrationsPath, file), 'utf8');

      migrations.push({ version, name, sql });
    }

    return migrations;
  }

  /**
   * Apply a single migration
   */
  private async applyMigration(migration: Migration): Promise<void> {
    console.log(`🚀 Applying migration ${migration.version}: ${migration.name}`);
    
    try {
      // Execute migration in a transaction
      const client = await this.dbPool.getClient();
      try {
        await client.query('BEGIN');
        
        // Execute the migration SQL
        await client.query(migration.sql);
        
        // Record migration as applied
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        
        await client.query('COMMIT');
        console.log(`✅ Migration ${migration.version} applied successfully`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`❌ Failed to apply migration ${migration.version}:`, error);
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<void> {
    console.log('🔧 Starting database migrations...');
    
    try {
      // Ensure migrations table exists
      await this.ensureMigrationsTable();
      
      // Load available migrations
      const availableMigrations = this.loadMigrationFiles();
      if (availableMigrations.length === 0) {
        console.log('📋 No migration files found');
        return;
      }
      
      // Get applied migrations
      const appliedMigrations = await this.getAppliedMigrations();
      
      // Find pending migrations
      const pendingMigrations = availableMigrations.filter(
        migration => !appliedMigrations.has(migration.version)
      );
      
      if (pendingMigrations.length === 0) {
        console.log('✅ Database is up to date, no migrations needed');
        return;
      }
      
      console.log(`📊 Found ${pendingMigrations.length} pending migrations`);
      
      // Apply pending migrations in order
      for (const migration of pendingMigrations) {
        await this.applyMigration(migration);
      }
      
      console.log(`🎉 Successfully applied ${pendingMigrations.length} migrations`);
      
    } catch (error) {
      console.error('💥 Migration failed:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async getStatus(): Promise<{ applied: number; pending: number; total: number }> {
    await this.ensureMigrationsTable();
    
    const availableMigrations = this.loadMigrationFiles();
    const appliedMigrations = await this.getAppliedMigrations();
    
    const pendingCount = availableMigrations.filter(
      migration => !appliedMigrations.has(migration.version)
    ).length;
    
    return {
      applied: appliedMigrations.size,
      pending: pendingCount,
      total: availableMigrations.length
    };
  }
}