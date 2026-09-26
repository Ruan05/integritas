export type JobStatus =
  | 'Queued'
  | 'Extracting'
  | 'Analyzing'
  | 'Researching'
  | 'Verifying'
  | 'Drafting report'
  | 'Completed'
  | 'Needs review';

export type PipelineStep = {
  label: string;
  status: 'done' | 'active' | 'waiting';
};

export type CaseSummary = {
  id: string;
  name: string;
  risk: 'Low' | 'Medium' | 'High';
  status: JobStatus;
  updatedAt: string;
};
