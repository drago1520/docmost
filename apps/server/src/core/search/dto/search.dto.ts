import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { SEARCH_MODES, SearchMode } from '../search-strategies';

export const SEARCH_QUERY_MAX_LENGTH = 200;

export class SearchDTO {
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  query?: string;

  @IsOptional()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsString()
  shareId?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  labelIds?: string[];

  @IsOptional()
  @IsIn(SEARCH_MODES)
  mode?: SearchMode;

  @IsOptional()
  @IsBoolean()
  titleOnly?: boolean;

  // searches without a spaceId leave archived spaces out unless this is set
  @IsOptional()
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsNumber()
  offset?: number;
}

export class SearchShareDTO extends SearchDTO {
  @IsNotEmpty()
  @IsString()
  shareId: string;

  @IsOptional()
  @IsUUID()
  spaceId: string;
}

export class SearchPublicSpaceDTO extends SearchDTO {
  @IsNotEmpty()
  @IsString()
  spaceSlug: string;
}

export class SearchSuggestionDTO {
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  query: string;

  @IsOptional()
  @IsBoolean()
  includeUsers?: boolean;

  @IsOptional()
  @IsBoolean()
  includeGroups?: boolean;

  @IsOptional()
  @IsBoolean()
  includePages?: boolean;

  @IsOptional()
  @IsString()
  spaceId?: string;

  @IsOptional()
  @IsNumber()
  limit?: number;
}
