type BlogsResponse = {
  items: BlogResponse[];
  responseDateTime: string;
};

type BlogResponse = {
  blogID: string;
  blogTitle: string;
  blogBody: string;
  blogDate: string;
  responseDateTime: string;
};

type CompanyLogo = {
  key: string;
  logo: string;
};

type CompanyLogos = CompanyLogo[];
