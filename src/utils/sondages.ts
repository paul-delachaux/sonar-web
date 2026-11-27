export type SondageLayout = 'single_choice' | 'multiple_choice' | 'scale' | 'dichotomous';

export type SondageOption = {
  id: string;
  label: string;
  label_en?: string | null;
};

type PollWithData = {
  data: {
    layout?: SondageLayout;
    options?: SondageOption[];
  };
};

export function sondageOptions(poll: PollWithData): SondageOption[] {
  if (poll.data.layout === 'scale') {
    return Array.from({ length: 10 }, (_, index) => {
      const value = String(index + 1);
      return { id: value, label: value, label_en: value };
    });
  }
  if (poll.data.layout === 'dichotomous') {
    return [
      { id: 'no', label: 'Non', label_en: 'No' },
      { id: 'yes', label: 'Oui', label_en: 'Yes' },
    ];
  }
  return poll.data.options || [];
}
